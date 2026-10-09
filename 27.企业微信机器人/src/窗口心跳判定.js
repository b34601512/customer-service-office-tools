"use strict";

/**
 * 窗口心跳判定 —— 纯函数（无 IO、无副作用，便于单测）。
 *
 * 背景（2026-10-09，黎路遥拍板；赵敏/程灵素对齐）：
 * - pi 窗口挂了要能在机器人留言板发 [故障]，死窗口自己报不了自己 → 心跳写手随窗口停写，
 *   由独立 5 分钟看门狗（scripts/企微看门狗.js）判定并写板。
 * - 三条对齐要点：①写手随窗口同生共死（窗口挂＝写手停、心跳自然过期）
 *   ②同一故障 60 分钟内不重报，恢复发 [已解决] ③上次关机残留忽略（心跳早于本次开机→不判挂）+ 开机 30 分钟宽限。
 *
 * 判定口径：
 * - 应活窗口 = 监听窗 + 任务窗.json 里登记且**回执未落**的任务窗；
 *   另外，有心跳记录但登记被摘（窗口异常死亡时守卫会摘登记）的，只要回执没落也照样算应活——
 *   否则死窗会被"悄悄销号"，而这正是最该报的情况。
 * - 异常 = 心跳 > staleMin（默认 10）分钟没更新 **或** 认窗 pid 不在（进程扫描双保险；扫描失败不算"不在"）。
 * - 开机 30 分钟内不报（写手/窗口可能还没起来）；心跳早于本次开机时刻的旧记录按关机残留忽略
 *   （监听窗例外：过了宽限还没新心跳，说明开机后监听窗没起来，要报）。
 * - 回执已落的任务窗不告警（工收完了，等守卫收窗）。
 * - 同一窗口告警后 dedupeMin（默认 60）分钟内不重报；恢复正常则出一条 [已解决]。
 */

const path = require("path");

const MINUTE = 60 * 1000;

const DEFAULT_HEARTBEAT_CONFIG = Object.freeze({
  staleMin: 10,        // 心跳超时（分钟）
  bootGraceMin: 30,    // 开机宽限（分钟）
  dedupeMin: 60,       // 同窗重报冷却（分钟）
  missingGraceMin: 10, // 无心跳记录的宽限：任务窗按开窗时间起算
  listenerName: "监听窗"
});

/** 统一键：反斜杠、去尾斜杠、小写（Windows 路径不区分大小写）。 */
function 规整键(s) {
  return String(s || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function 解析毫秒(v) {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function 取认窗(记录) {
  const v = (记录 && 记录.认窗) || [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x || "")).filter(Boolean);
}

/** 纯进程命中判定：进程列表不可用（非数组）→ 返回 null（未知，不许当"不在"）。 */
function 进程命中(进程列表, pid, 认窗组) {
  if (!Array.isArray(进程列表)) return null;
  const 组 = Array.isArray(认窗组) ? 认窗组 : [认窗组];
  return 进程列表.some(
    (p) => Number(p && p.pid) === Number(pid) && 组.every((s) => String((p && p.命令行) || "").includes(s))
  );
}

/**
 * 判定一轮。输入均为快照（由调用方负责读文件/扫进程）：
 *  - 记录: 窗口心跳.json 里的 { 窗口 } 映射转成数组；每条 {名,类型,pid,认窗,启动时间,最后心跳,已交回执?}
 *  - 任务窗: 任务窗.json 的窗口数组；每条需带 回执已落:boolean（调用方算好）
 *  - 进程列表: [{pid, 命令行}]；null = 扫描失败（本轮不判 pid 不在）
 *  - 上线时间Ms: 心跳功能首次运行的时刻（历史窗口不追着要心跳）；null = 第一次跑
 *  - 上次状态: { windows: {键: {...}} }（上次落盘）
 * 输出：{ toAlert, toResolve, 状态, 目标, 摘要 }
 */
function 判定心跳({
  nowMs,
  bootTimeMs = null,
  记录: 记录入 = [],
  任务窗: 任务窗入 = [],
  进程列表: 进程列表入 = null,
  上线时间Ms = null,
  上次状态 = {},
  config = {}
} = {}) {
  const 记录 = Array.isArray(记录入) ? 记录入 : [];
  const 任务窗 = Array.isArray(任务窗入) ? 任务窗入 : [];
  const 进程列表 = Array.isArray(进程列表入) ? 进程列表入 : null;
  const 上次窗口 = 上次状态 && typeof 上次状态 === "object" && 上次状态.windows && typeof 上次状态.windows === "object" ? 上次状态.windows : {};
  const cfg = { ...DEFAULT_HEARTBEAT_CONFIG, ...(config || {}) };
  const 有开机时刻 = Number.isFinite(bootTimeMs);
  const 开机宽限 = 有开机时刻 && nowMs - bootTimeMs < cfg.bootGraceMin * MINUTE;
  const 时间到 = (t) => new Date(t).toISOString();

  // ---------------- 组建应活窗口目标 ----------------
  const 目标 = [];
  const 已加 = new Set();
  const 加目标 = (t) => {
    if (!已加.has(t.键)) {
      已加.add(t.键);
      目标.push(t);
    }
  };

  // 1) 监听窗（先挑最后心跳最新的一条监听记录）
  const 监听记录 =
    [...记录]
      .filter((r) => String(r && r.类型) === "listener")
      .sort((a, b) => (解析毫秒(b && b.最后心跳) || 0) - (解析毫秒(a && a.最后心跳) || 0))[0] || null;
  加目标({ 键: "listener", 名: cfg.listenerName, 类型: "listener", 记录: 监听记录, 开窗时间Ms: null, 来源: "监听窗" });

  // 2) 登记且回执未落的任务窗
  for (const t of 任务窗) {
    if (!t || !t.任务) continue;
    if (t.回执已落) continue;
    const 键 = 规整键("@" + t.任务);
    const 命中记录 = 记录.find((r) => String(r && r.类型) !== "listener" && 取认窗(r).some((x) => 规整键(x) === 键)) || null;
    加目标({
      键,
      名: "任务窗·" + path.basename(String(t.任务)),
      类型: "task",
      记录: 命中记录,
      开窗时间Ms: 解析毫秒(t.开窗时间),
      来源: "登记"
    });
  }

  // 3) 有记录、但登记里没有（异常死亡时守卫摘了登记；正常收窗的记录会被清掉）
  for (const r of 记录) {
    if (String(r && r.类型) === "listener") continue;
    const 组 = 取认窗(r);
    if (!组.length) continue;
    const 键 = 规整键(组[0]);
    if (已加.has(键)) continue;
    if (r.已交回执) continue; // 回执已落 = 已收工，不告警
    加目标({ 键, 名: (r && r.名) || "任务窗·" + 组[0], 类型: "task", 记录: r, 开窗时间Ms: null, 来源: "记录" });
  }

  // ---------------- 逐个判定 ----------------
  const toAlert = [];
  const toResolve = [];
  const 窗口状态 = {};
  let 正常数 = 0;
  let 忽略数 = 0;

  for (const 目标项 of 目标) {
    const 上 = (上次窗口[目标项.键] || {});
    const 状态 = {
      名: 目标项.名,
      类型: 目标项.类型,
      pid: null,
      最后心跳: null,
      状态: "",
      告警中: !!上.告警中,
      lastAlertAt: 上.lastAlertAt || null,
      lastResolveAt: 上.lastResolveAt || null
    };
    let 异常 = null; // {原因, 证据}

    if (!目标项.记录) {
      if (上线时间Ms == null) {
        // 心跳功能第一次跑：老窗口（含监听窗）都还没挂写手，给一个周期等首拍——避免“上线即误报”。
        状态.状态 = "心跳首次上线（等首拍）";
      } else if (目标项.类型 === "listener") {
        异常 = { 原因: "没有心跳记录（监听窗写手没起来？）", 证据: "本机没有任何监听窗心跳" };
      } else if (目标项.开窗时间Ms != null && nowMs - 目标项.开窗时间Ms < cfg.missingGraceMin * MINUTE) {
        状态.状态 = "等待首次心跳";
      } else if (目标项.开窗时间Ms != null && 目标项.开窗时间Ms < 上线时间Ms) {
        状态.状态 = "心跳上线前开的窗（不告警）";
      } else {
        异常 = {
          原因: "没有心跳记录（写手没起来？）",
          证据: 目标项.开窗时间Ms != null ? `登记开窗 ${时间到(目标项.开窗时间Ms)}，从未收到心跳` : "登记里没有开窗时间，也从未收到心跳"
        };
      }
    } else {
      const 心跳Ms = 解析毫秒(目标项.记录 && 目标项.记录.最后心跳);
      const 组 = 取认窗(目标项.记录);
      状态.pid = (目标项.记录 && 目标项.记录.pid) || null;
      状态.最后心跳 = (目标项.记录 && 目标项.记录.最后心跳) || null;

      if (心跳Ms == null) {
        异常 = { 原因: "心跳记录坏了（最后心跳读不出来）", 证据: `记录键 ${目标项.键}；pid=${状态.pid}` };
      } else if (有开机时刻 && 心跳Ms < bootTimeMs) {
        if (目标项.类型 === "listener") {
          if (!开机宽限) {
            异常 = { 原因: "心跳早于本次开机（监听窗写手没起来？）", 证据: `最后心跳 ${时间到(心跳Ms)}，本次开机 ${时间到(bootTimeMs)}` };
          } else {
            状态.状态 = "开机宽限（旧记录）";
          }
        } else {
          状态.状态 = "旧记录（早于本次开机，按关机残留忽略）";
        }
      } else {
        const 分钟前 = Math.max(0, Math.round((nowMs - 心跳Ms) / MINUTE));
        const pid命中 = 进程命中(进程列表, 状态.pid, 组);
        if (nowMs - 心跳Ms > cfg.staleMin * MINUTE) {
          异常 = {
            原因: `超过 ${cfg.staleMin} 分钟没有心跳`,
            证据: `pid=${状态.pid}，最后心跳 ${分钟前} 分钟前（${时间到(心跳Ms)}），进程扫描${pid命中 === null ? "不可用" : pid命中 ? "里在" : "里不在"}`
          };
        } else if (pid命中 === false) {
          异常 = {
            原因: "认窗进程不在",
            证据: `pid=${状态.pid} 不在进程扫描里，最后心跳 ${分钟前} 分钟前（${时间到(心跳Ms)}）`
          };
        } else {
          状态.状态 = "正常";
        }
      }
    }

    // 报警 / 恢复
    if (异常 && 开机宽限) {
      状态.状态 = `开机宽限（宽限内不报：${异常.原因}）`;
      // 告警中保持原样，等宽限过去再报
    } else if (异常) {
      const 到点 = !状态.告警中 || !状态.lastAlertAt || nowMs - (解析毫秒(状态.lastAlertAt) || 0) >= cfg.dedupeMin * MINUTE;
      if (到点) {
        toAlert.push({ 键: 目标项.键, 名: 目标项.名, 类型: 目标项.类型, 原因: 异常.原因, 证据: 异常.证据, pid: 状态.pid, 最后心跳: 状态.最后心跳 });
        状态.告警中 = true;
        状态.lastAlertAt = 时间到(nowMs);
        状态.状态 = "告警：" + 异常.原因;
      } else {
        状态.告警中 = true;
        状态.状态 = `告警中（${cfg.dedupeMin} 分钟内不重报）：${异常.原因}`;
      }
    } else if (状态.状态 === "正常") {
      正常数++;
      if (状态.告警中) {
        toResolve.push({ 键: 目标项.键, 名: 目标项.名, 类型: 目标项.类型, 原因: "心跳恢复", pid: 状态.pid, 最后心跳: 状态.最后心跳 });
        状态.告警中 = false;
        状态.lastAlertAt = null;
        状态.lastResolveAt = 时间到(nowMs);
      }
    } else {
      // 旧记录忽略 / 等待首拍 / 开机宽限：不报也不销旧告警
      忽略数++;
    }

    窗口状态[目标项.键] = 状态;
  }

  // 上一次告警中、这次目标整个消失（记录被清 = 正常收窗）→ 补一条 [已解决]
  for (const [键, 上] of Object.entries(上次窗口)) {
    if (!上 || !上.告警中) continue;
    if (已加.has(键)) continue;
    toResolve.push({ 键, 名: 上.名 || 键, 类型: 上.类型 || "task", 原因: "记录已清（窗口正常收窗）", pid: null, 最后心跳: null });
  }

  const 上线At = 上线时间Ms != null ? 上线时间Ms : nowMs;
  return {
    toAlert,
    toResolve,
    目标: 目标.map((t) => ({ 键: t.键, 名: t.名, 类型: t.类型, 来源: t.来源 })),
    状态: {
      更新At: 时间到(nowMs),
      开机时刻: 有开机时刻 ? 时间到(bootTimeMs) : null,
      上线At: 时间到(上线At),
      windows: 窗口状态
    },
    摘要: { 目标数: 目标.length, 正常: 正常数, 忽略: 忽略数, 告警: toAlert.length, 恢复: toResolve.length }
  };
}

module.exports = {
  DEFAULT_HEARTBEAT_CONFIG,
  判定心跳,
  进程命中,
  规整键,
  解析毫秒
};
