#!/usr/bin/env node
"use strict";
/**
 * 派回访 —— 「电话漏接 → 安排人回访」收成一条命令（#714，2026-11-09 黎路遥定）
 *
 * 干什么（顺序固定，不能换）：
 *   ① 写「售后待办清单」一行（负责人 / 截止 / 来源都写进去）
 *   ② 私聊把这件事发给被派的人，并留痕
 *   ③ 私聊发不进去 → **立刻停**（不重试、不换人），打印「需确认后群发」的命令给木婉清
 *
 * 用法：
 *   node 工具/派回访.cjs --电话 15072276247 --客户 "襄阳 外卖单" --派 柯某某 --派id woXXXXXXXX \
 *     --来源 "2026-11-09 电话漏接巡检 黎路遥叫" [--截止 "2026-11-09 23:59:59"] [--备注 "排队91秒"] [--干]
 *   node 工具/派回访.cjs --help
 *
 * 退 出 码：0 全成｜2 参数/前置不合格（什么都没做）｜3 写待办失败（含 850003 文档权限过期）
 *           4 私聊发不进去（需确认后群发）｜5 私聊其它失败
 *
 * 为什么这么设计（别改成"聪明一点"）：
 *   - **不查值班、不猜负责人**：黎路遥 2026-11-05 定过"默认查值班"，但这条流程是"黎路遥指名派人"，
 *     所以这里必须显式给 --派 和 --派id；少一个就退 2。两个一起给还有个用处：能和 人.local.json
 *     对上——对不上说明名字和 userid 不是同一个人，宁可不发，也不把客户电话发给另一个人。
 *   - **私聊失败一律停**：重试会重复弹窗、换人会把活派给不在场的人。停 + 报，由木婉清找黎路遥定。
 *   - **群发只打印命令，不代发**：群发要求精确群名 + ≥8 字理由 + 一次性路由票（共享消息流硬锁），
 *     而且这条流程要求"黎路遥确认后才群通知"。工具自己发＝绕过确认。
 *   - **干跑与真跑分离**：--干 只打印将要写什么、发给谁、正文长什么样，不碰文档、不发消息。
 *
 * 关于 846607（写死前先看这条）：
 *   本机台账（木婉清 工具/企微/.state/发消息台账.jsonl，2026-11-04）里平台的原文是
 *   `aibot send msg frequency limit exceeded` —— 是 aibot 的发送频率/额度上限，
 *   **不是"对方没跟机器人说过话"**。所以这里不按原因分叉，只按事实分叉：发不进去就停；
 *   回执原文照打出来，别替平台编原因。
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const 仓库根 = path.resolve(__dirname, "..");
const 写待办 = path.join(__dirname, "售后待办", "写售后待办.cjs");
const 台账目录 = path.join(__dirname, ".state");
// 企微消息流在本机的位置（仓库里没有：它跟着木婉清的窗走）。要换机器就改这里或给环境变量。
const 企微工具 = process.env.派回访_企微工具 || "D:/桌面/木婉清/工具/企微";
const 发企微 = path.join(企微工具, "发企微.cjs");
const 人表 = path.join(企微工具, "人.local.json");

function 用法() {
  console.log(`派回访 —— 电话漏接 → 写售后待办 + 私聊派 + 发不进就停

用法：
  node 工具/派回访.cjs --电话 <号码> --客户 <谁/哪单> --派 <人名> --派id <userid> --来源 <≥8字>
                       [--截止 "<YYYY-MM-DD HH:mm:ss>"] [--备注 <补充>] [--干]

例：
  node 工具/派回访.cjs --电话 15072276247 --客户 "襄阳 外卖单" --派 柯某某 --派id woXXXXXX \\
    --来源 "2026-11-09 电话漏接巡检 黎路遥叫" --备注 "11-08 18:40 排队 91 秒"

退出码：0 全成｜2 参数/前置不合格｜3 写待办失败（850003＝文档权限过期）｜4 私聊发不进（需确认后群发）｜5 私聊其它失败`);
}

function 解析(argv) {
  const o = { 干: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--干") o.干 = true;
    else if (a === "--电话") o.电话 = String(argv[++i] || "").trim();
    else if (a === "--客户") o.客户 = String(argv[++i] || "").trim();
    else if (a === "--派") o.派 = String(argv[++i] || "").trim();
    else if (a === "--派id") o.派id = String(argv[++i] || "").trim();
    else if (a === "--来源") o.来源 = String(argv[++i] || "").trim();
    else if (a === "--截止") o.截止 = String(argv[++i] || "").trim();
    else if (a === "--备注") o.备注 = String(argv[++i] || "").trim();
    else throw new Error(`不认识的参数：${a}（不认识的开关一律拒收，免得被当成正文发出去）`);
  }
  return o;
}

function 本地日时(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 23:59:59`;
}

/** 参数与前置条件。任何一条不满足：退 2，什么都不做。 */
function 校验(o) {
  const 缺 = [];
  if (!o.电话) 缺.push("--电话");
  if (!o.客户) 缺.push("--客户");
  if (!o.派) 缺.push("--派 <人名>");
  if (!o.派id) 缺.push("--派id <userid>");
  if (!o.来源) 缺.push("--来源");
  if (缺.length) throw new Error(`缺参数：${缺.join("、")}（派给谁必须显式给名字和 userid，工具不查值班、不猜）`);
  if (!/^\d{5,20}$/.test(o.电话)) throw new Error(`--电话 要是数字：${o.电话}`);
  if (o.来源.length < 8) throw new Error(`--来源 至少 8 个字（要看出「哪天、哪项巡检、谁叫的」）：现在 ${o.来源.length} 个`);
  if (o.截止 && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(o.截止)) throw new Error(`--截止 格式要 "YYYY-MM-DD HH:mm:ss"：${o.截止}`);

  // 名字和 userid 必须是同一个人：如果这里对不上，下一步就会把客户电话私聊给另一个人。
  //   ⚠ 两套系统的叫法不一样：待办表的负责人要“柯崇婷”，人.local.json 里写的是“柯崇婷（售后）”。
  //     所以这里允许「精确相等」或「提示后缀（…）」两种，但**必须只命中一人**，并且命中的 id 要等于 --派id。
  let 表 = {};
  try { 表 = JSON.parse(fs.readFileSync(人表, "utf8")); } catch { throw new Error(`读不到本机人名表：${人表}（企微消息流不在本机？可用环境变量 派回访_企微工具 指路）`); }
  const 候选 = Object.entries(表).filter(([k, v]) =>
    !k.startsWith("_") && /^wo[A-Za-z0-9_-]{10,}$/.test(k) &&
    (String(v).trim() === o.派 || String(v).trim().startsWith(`${o.派}（`)));
  if (候选.length !== 1) {
    const 名单 = Object.entries(表).filter(([k]) => /^wo[A-Za-z0-9_-]{10,}$/.test(k)).map(([, v]) => v).join("、");
    throw new Error(`本机人名表里「${o.派}」命中 ${候选.length} 人（要精确到唯一）。表里现有：${名单 || "（空）"}`);
  }
  const [真id, 私聊名] = 候选[0];
  if (真id !== o.派id) throw new Error(`名字和 userid 对不上：--派「${o.派}」→「${私聊名}」的 id 是 ${真id}，不是 ${o.派id}。宁可不发，也不把客户电话发给另一个人`);
  return { 私聊名: String(私聊名).trim() };
}

/** 干跑/真跑都打印这一段：将要做什么，人一眼能核对 */
function 打印计划(o, 待办正文, 私聊正文, 截止, 私聊名) {
  console.log("── 将要做的事 ──");
  console.log(`① 写「售后待办清单」一行：${待办正文}`);
  console.log(`   负责人：${o.派}（${o.派id}）　截止：${截止}`);
  console.log(`② 私聊给「${私聊名}」：`);
  for (const 行 of 私聊正文.split("\n")) console.log(`   | ${行}`);
}

/** 企微 CLI 在哪：先试 Windows 上 npm 全局默认目录，再问 `npm root -g`（不在两处各抄一份写死路径） */
function 找企微CLI() {
  const 候选 = [];
  if (process.env.APPDATA) 候选.push(path.join(process.env.APPDATA, "npm", "node_modules", "@wecom", "cli", "bin", "wecom.js"));
  const p = 候选.find((x) => fs.existsSync(x));
  if (p) return p;
  // 用一整条命令字符串，不用 argv 数组 + shell（Node 22 会对那种写法报 DEP0190）
  const r = spawnSync("npm root -g", { encoding: "utf8", shell: true, timeout: 60000 });
  const 根 = String(r.stdout || "").trim();
  if (!根) return null;
  const q = path.join(根, "@wecom", "cli", "bin", "wecom.js");
  return fs.existsSync(q) ? q : null;
}

/** 只读预检：文档读得到吗（850003＝授权过期，今天这表谁也写不了） */
function 验文档可达() {
  let 表cfg;
  try {
    表cfg = require(path.join(__dirname, "售后待办", "写售后待办.cjs"));
  } catch (e) {
    return { ok: false, 说明: `加载写售后待办失败：${e.message}` };
  }
  let docid, sheet;
  try {
    ({ docid, sheet } = 表cfg.读表配置());
  } catch (e) {
    return { ok: false, 说明: `拿不到 docid：${e.message}` };
  }
  if (!docid) return { ok: false, 说明: "拿不到 docid（本机配置 工具/售后待办/售后待办.local.json 或环境变量 WECOM_售后待办DOCID）" };
  const cli = 找企微CLI();
  if (!cli) return { ok: true, 跳过: true, 说明: "找不到 @wecom/cli，没做授权预检（写的时候失败会按 850003 报）" };
  const r = spawnSync(process.execPath, [cli, "smartsheet", "records", "list", "--docid", docid, "--sheet-title", sheet || 表cfg.SHEET, "--limit", "1"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const 字样 = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status === 0) return { ok: true };
  if (字样.includes("850003")) return { ok: false, 权限过期: true, 说明: "文档权限过期（850003）" };
  return { ok: false, 说明: 字样.slice(0, 300) };
}

function 写台账(行) {
  try {
    fs.mkdirSync(台账目录, { recursive: true });
    fs.appendFileSync(path.join(台账目录, "派回访台账.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...行 }) + "\n", "utf8");
  } catch { /* 台账写不进去不改变主流程结果 */ }
}

function 主() {
  const o = 解析(process.argv.slice(2));
  if (o.help) { 用法(); return 0; }
  const { 私聊名 } = 校验(o);

  const 截止 = o.截止 || 本地日时();
  const 待办正文 = `[${o.来源}] 回访 ${o.电话}（${o.客户}）${o.备注 ? `｜${o.备注}` : ""}`;
  const 私聊正文 = [
    `【回访派单】${o.客户}　${o.电话}`,
    `来源：${o.来源}`,
    `截止：${截止}`,
    "回访完回我一句结果（已联系／未接通／已约时间）。",
  ].join("\n");

  打印计划(o, 待办正文, 私聊正文, 截止, 私聊名);
  if (o.干) { console.log("\n（--干：上面只是计划，没写表、没发消息）"); return 0; }

  // ① 写待办：先验文档可达，再写（权限过期就别写半截）
  const 验 = 验文档可达();
  if (验.跳过) console.error(`\n⚠ ${验.说明}`);
  if (!验.ok) {
    console.error(`\n✗ 写待办这一步过不去：${验.说明}`);
    if (验.权限过期) console.error("  850003 是文档权限过期，只能黎路遥重新授权；不是工具坏了。今天**没写表、没发消息**。");
    写台账({ 电话: o.电话, 客户: o.客户, 派: o.派, 派id: o.派id, 来源: o.来源, 阶段: "验文档", 结果: 验.说明, 退出码: 3 });
    return 3;
  }
  const 写r = spawnSync(process.execPath, [写待办, "--content", 待办正文, "--owner", o.派id, "--owner-name", o.派, "--deadline", 截止], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const 写字样 = `${写r.stdout || ""}${写r.stderr || ""}`;
  if (写r.status !== 0 || /"回读命中":\s*false/.test(写字样)) {
    const 权 = 写字样.includes("850003");
    console.error(`\n✗ 写售后待办失败（退出码 ${写r.status}）${权 ? "：文档权限过期 850003" : ""}`);
    console.error(写字样.trim().slice(0, 600));
    console.error("  → 待办没写成，**没有往下发私聊**（先有记录，再派人；不然又是「只发了消息、查不到记录」）。");
    写台账({ 电话: o.电话, 客户: o.客户, 派: o.派, 派id: o.派id, 来源: o.来源, 阶段: "写待办", 结果: 权 ? "850003 权限过期" : `退出码 ${写r.status}`, 退出码: 3 });
    return 3;
  }
  const 待办id = (写字样.match(/"新行id"\s*:\s*"([^"]+)"/) || [])[1] || "";
  console.log(`\n✓ 售后待办已写入${待办id ? `（记录 ${待办id}）` : ""}，回读命中`);

  // ② 私聊：一次，不重试
  const 正文文件 = path.join(台账目录, `私聊-${o.电话}-${Date.now()}.txt`);
  fs.mkdirSync(台账目录, { recursive: true });
  fs.writeFileSync(正文文件, 私聊正文, "utf8");
  const 发r = spawnSync(process.execPath, [发企微, "--人", 私聊名, "--file", 正文文件, "--send"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, cwd: 企微工具 });
  const 发字样 = `${发r.stdout || ""}${发r.stderr || ""}`.trim();
  const 频限 = 发字样.includes("846607");

  if (发r.status === 0) {
    console.log(`✓ 已私聊发给「${私聊名}」`);
    写台账({ 电话: o.电话, 客户: o.客户, 派: o.派, 派id: o.派id, 来源: o.来源, 待办id, 阶段: "私聊", 结果: "已发", 退出码: 0 });
    return 0;
  }

  console.error(`\n✗ 私聊没发出去（退出码 ${发r.status}）${频限 ? "：回执里是 846607" : ""}`);
  console.error(发字样.slice(0, 600) || "（没有输出）");
  if (频限) console.error("  846607 按本机台账的原文是「aibot send msg frequency limit exceeded」＝aibot 发送频率/额度上限，不是「对方没跟机器人说过话」。以回执原文为准。");
  console.error("  → 按规矩停在这里：不重试、不换人。要不要群通知，由木婉清找黎路遥确认。");
  console.error("\n需确认后群发（先预览，确认了再加 --send；群名必须精确，不许填编号/chatid）：");
  const 群理由 = `${o.派}私聊未通，黎路遥确认改群通知（客户电话需转达）`;
  console.error(`  cd "${企微工具}"`);
  console.error(`  node 发企微.cjs --群 "售后群" --理由 "${群理由}" --例外 "私聊 846607，黎路遥已确认群通知" --text "【回访派单】${o.客户} ${o.电话}，请${o.派}今天回访，回话请私聊木婉清"`);
  console.error(`  （核对无误再在末尾加 --send）`);
  写台账({ 电话: o.电话, 客户: o.客户, 派: o.派, 派id: o.派id, 来源: o.来源, 待办id, 阶段: "私聊", 结果: 频限 ? "846607 频率/额度上限" : `退出码 ${发r.status}`, 退出码: 频限 ? 4 : 5 });
  return 频限 ? 4 : 5;
}

if (require.main === module) {
  try {
    process.exitCode = 主();
  } catch (e) {
    console.error("✗ " + (e && e.message ? e.message : e));
    process.exitCode = 2;
  }
}
module.exports = { 解析, 校验, 本地日时, 验文档可达, 找企微CLI };
