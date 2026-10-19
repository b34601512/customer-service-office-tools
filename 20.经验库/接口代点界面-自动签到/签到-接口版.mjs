#!/usr/bin/env node
// 每日签到·接口版（通用模板）
//
// 原理：同一个客户端/网站，登录令牌通常存在本地；把「点一下签到」背后那个
//       POST 请求直接发出去，就不需要开窗口、不需要点元素。
//
// 用法：
//   node 签到-接口版.mjs            # 正常跑（带时段门、记档门）
//   node 签到-接口版.mjs --测试      # 只打一次看结果，不动状态、不报功
//
// ⚠️ 用之前必改两处：① 接口地址 ② 令牌文件候选路径（③ 报功方式可选，用环境变量配）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ========== ① 改这里：接口地址 ==========
const 接口地址 = "https://www.workbuddy.cn/v2/billing/meter/daily-checkin";

// ========== ② 改这里：令牌文件候选路径（按顺序找，找到第一个就用） ==========
const 令牌候选 = [
  "C:/Users/<你>/AppData/Local/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info",
  "C:/Users/<你>/AppData/Local/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info",
];

// ========== ③ 状态和日志放哪（一般不用改：默认落在脚本同级 .state/，多机各跑各的不打架） ==========
const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 状态文件 = process.env.签到状态文件 || path.join(本目录, ".state", "签到-接口版.json");
const 日志文件 = process.env.签到日志文件 || path.join(本目录, ".state", "签到-接口版.log");

try { fs.mkdirSync(path.dirname(状态文件), { recursive: true }); } catch { /* 建不出来不致命 */ }
try { fs.mkdirSync(path.dirname(日志文件), { recursive: true }); } catch { /* 同上 */ }

// ========== 下面一般不用改 ==========

const 测试 = process.argv.includes("--测试");
const 今日 = new Date().toISOString().slice(0, 10);

const log = (s) => {
  const 行 = new Date().toISOString() + " " + s;
  try { fs.appendFileSync(日志文件, 行 + "\n"); } catch { /* 日志写不进不致命 */ }
  console.log(行);
};

const 读状态 = () => { try { return JSON.parse(fs.readFileSync(状态文件, "utf8")); } catch { return {}; } };
const 写状态 = (v) => { try { fs.writeFileSync(状态文件, JSON.stringify(v, null, 1)); } catch {} };

const st = 读状态();

// ---------- ⑤ 时段门：别半夜乱跑 ----------
const 点钟 = new Date().getHours() + new Date().getMinutes() / 60;
if (!测试 && (点钟 < 6 || 点钟 > 22)) {
  log("不在允许时段（6:00-22:00），跳过");
  process.exit(0);
}

// ---------- 记档门：一天只领一次 ----------
if (!测试 && st.lastSuccess === 今日) {
  log("今天已领过（记档），跳过");
  process.exit(0);
}

// ---------- 找令牌 ----------
const 令牌文件 = 令牌候选.find((p) => fs.existsSync(p));
if (!令牌文件) {
  log("找不到令牌文件，放弃（检查路径，或先登录一次客户端）");
  process.exit(1);
}

let 令牌 = "";
try {
  const j = JSON.parse(fs.readFileSync(令牌文件, "utf8"));
  令牌 = j.accessToken || (j.auth && j.auth.accessToken) || "";
} catch (e) {
  log("令牌文件读不动：" + e.message);
  process.exit(1);
}
if (!令牌) {
  log("令牌为空（可能要重登客户端），放弃");
  process.exit(1);
}

// ---------- 打接口 ----------
const 打 = async (url) => {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + 令牌,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",   // ⚠️ 别省，不少接口没有 UA 直接拒
    },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  let t = "";
  try { t = await r.text(); } catch { /* 读不到 body 也不要紧 */ }
  return { status: r.status, body: t.slice(0, 200) };
};

let 结果;
try {
  结果 = await 打(接口地址);
} catch (e) {
  log("请求失败：" + String(e.message).slice(0, 100) + "（下轮再试）");
  process.exit(1);
}

log("接口回：" + 结果.status + " " + 结果.body);

// ---------- 判结果（分级，别一刀切） ----------
const 成功 = 结果.status === 200 && !/error|fail/i.test(结果.body);
const 已领 = /已签到|已领取|already/i.test(结果.body);

if (成功 || 已领) {
  if (测试) {
    log("（测试）通道验证 ✓");
    process.exit(0);
  }
  st.lastSuccess = 今日;
  写状态(st);

  if (成功) {
    // ---------- 报功（这也是心跳，没消息就分不清「领了没说」和「脚本死了」）----------
    // 报功方式五花八门（企微机器人/桌面通知/写日志），用环境变量注入，模板不绑死任何一家：
    //   签到报功命令=node D:\工具\企微发消息.cjs --回复 "{msg}"
    const 报功命令 = process.env.签到报功命令 || "";
    if (报功命令) {
      try {
        const { spawnSync } = await import("node:child_process");
        spawnSync(
          报功命令.replace("{msg}", "今天积分帮你领了 ✓（接口版：一个请求、毫秒级、没碰你界面）"),
          { shell: true, encoding: "utf8", timeout: 60000, windowsHide: true },
        );
      } catch { /* 报功失败不影响领取结果 */ }
      log("★ 领取成功并报功");
    } else {
      log("★ 领取成功（未配置奖励报功命令，只写日志）");
    }
  } else {
    log("今天已签到（无需重领）");
  }
  process.exit(0);
}

if (结果.status === 401 || 结果.status === 403) {
  log("令牌被拒（" + 结果.status + "）——需要本人重登一下客户端");   // 说清「该谁做什么」
  process.exit(2);   // 2 = 需要人介入（和 1 = 暂时失败 分开）
}

log("其他情况，未领取成功（" + 结果.status + "）");
process.exit(1);
