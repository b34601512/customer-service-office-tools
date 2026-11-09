#!/usr/bin/env node
"use strict";
/**
 * 派活 —— 「查窗 →（不在就）开任务窗 → 发私信 → 打印回执命令」收成一条命令（#720，木婉清 2026-11-09 定）
 *
 * 为什么要有它：原来派一单活要 4 步 3 个工具，最容易漏的两步是
 *   ① 漏「查对端窗」——窗没开就把信投了，等于投进没人读的邮箱；
 *   ② 漏「开任务窗」的第二个参数「工作目录」——2026-11-05 就是这么把窗开进了木婉清家，
 *      对方的 AGENTS／工具／历史全没加载，老板看到一扇莫名其妙的窗。
 *   这两步都是「漏了不报错」的那种漏，所以必须由工具按顺序做，而不是靠人记得。
 *
 * 用法：
 *   node 工具/派活.cjs --人 "巡检员·霍青桐" --任务书 "任务/2026-11-09-xxx.md" --正文 "要她干什么" \
 *        [--工作目录 "D:/硅基公司/员工/03.巡检员·霍青桐"] [--不收窗] [--等 120] [--干]
 *
 *   --人        必填，通讯录里的名字（查窗、发私信都按它解析）
 *   --任务书    必填，相对 `0.木婉清档案` 或绝对路径；任务窗就是拿它当开场 prompt
 *   --正文      必填，私信正文；给的是已存在文件路径时按文件发（长文/反引号/换行用这个）
 *   --工作目录  窗不在时**必填**（没有它不许开窗——正是 11-05 那次事故的坑）
 *   --不收窗    透传给 开任务窗（同一家今天还要接着派活时用）
 *   --等        只用于打印「等回执」命令，默认 120 分钟
 *   --干        只查窗＋打印计划，不开窗、不发信
 *
 * 退出码：0 成｜2 参数或工作目录不合格（**什么都没做**）｜3 窗没起来｜4 私信发不进｜5 其它
 *
 * 三条自守规矩：
 *   - **不复写开窗/发信/查窗逻辑**：全部调现有命令（查对端窗／开任务窗／私信），一边一份会漂。
 *   - **判「窗起来没」用开任务窗自己的判据**（`--只查窗`），不用查对端窗：任务窗的命令行里只有任务书路径、
 *     没有家目录，查对端窗认不出它——会误报「不在」，然后我们就傻乎乎再开一扇。
 *   - **失败不重试、不换人**：开窗失败直接退 3；私信失败直接退 4，把原话打出来。
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const 仓根 = path.resolve(__dirname, "..");
const 档 = path.join(仓根, "0.木婉清档案");
const 查对端窗 = "D:/硅基公司/共享/企微工具/查对端窗.cjs";
const 开任务窗 = path.join(档, "开任务窗.cjs");
const 关任务窗 = path.join(档, "关任务窗.cjs");
const 等回执 = path.join(档, "等回执.cjs");
const 私信 = path.join(仓根, "工具/企微/私信.cjs");
const 临时目录 = path.join(仓根, "工具/.state");

function 用法() {
  console.log(`派活 —— 查窗 →（不在就）开任务窗 → 发私信 → 打印回执命令

用法：
  node 工具/派活.cjs --人 "<名字>" --任务书 "任务/xxx.md" --正文 "<要干什么>" [--工作目录 "<对方家绝对路径>"] [--干]

退出码：0 成｜2 参数/工作目录不合格（什么都没做）｜3 窗没起来｜4 私信发不进｜5 其它
注：--工作目录 只在「对方窗不在、要开任务窗」时才必填；已有窗就只发信。`);
}

function 解析(argv) {
  const o = { 干: false, 不收窗: false, 等: 120 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--干") o.干 = true;
    else if (a === "--不收窗") o.不收窗 = true;
    else if (a === "--人") o.人 = String(argv[++i] || "").trim();
    else if (a === "--任务书") o.任务书 = String(argv[++i] || "").trim();
    else if (a === "--正文") o.正文 = String(argv[++i] || "");
    else if (a === "--工作目录") o.工作目录 = String(argv[++i] || "").trim();
    else if (a === "--等") o.等 = Number(argv[++i]) || 120;
    else throw new Error(`不认识的参数：${a}（不认识的开关一律拒收，免得被当成任务内容）`);
  }
  return o;
}

/** 查对方那扇监听窗在不在（查对端窗的退出码：0 全在 / 1 有不在 / 2 名字解析不到） */
function 查窗(人) {
  const r = spawnSync(process.execPath, [查对端窗, 人], { encoding: "utf8", timeout: 120000 });
  const 出 = `${r.stdout || ""}${r.stderr || ""}`.trim();
  const pid = (出.match(/pid=([\d,]+)/) || [])[1] || "";
  return { 在: r.status === 0, 解析失败: r.status === 2, pid, 原文: 出 };
}

/** 「任务窗起来没」——用开任务窗自己的 `--只查窗`，它认『任务目录标记 + 家目录』两种命令行 */
function 查任务窗(任务书, 工作目录) {
  const r = spawnSync(process.execPath, [开任务窗, 任务书, 工作目录, "--只查窗"], { cwd: 档, encoding: "utf8", timeout: 60000 });
  const 出 = `${r.stdout || ""}${r.stderr || ""}`.trim();
  const 行 = 出.split(/\r?\n/).filter((x) => x.includes("同目录活窗")).pop() || "";
  return { 活着: !!行 && !/同目录活窗：无/.test(行), 原文: 出, 摘要: 行 };
}

const 睡 = (毫秒) => new Promise((r) => setTimeout(r, 毫秒));

async function 主() {
  const o = 解析(process.argv.slice(2));
  if (o.help) { 用法(); return 0; }

  // ── 参数（不合格：退 2，什么都不做）──
  if (!o.人) throw new Error("缺 --人（查窗和发私信都靠它）");
  if (!o.任务书) throw new Error("缺 --任务书（任务窗拿它当开场 prompt）");
  if (!o.正文) throw new Error("缺 --正文（私信要发什么）");
  const 任务文件 = path.isAbsolute(o.任务书) ? o.任务书 : path.resolve(档, o.任务书);
  if (!fs.existsSync(任务文件)) throw new Error(`任务书不存在：${任务文件}`);
  if (o.工作目录) {
    o.工作目录 = path.resolve(仓根, o.工作目录);
    if (!fs.existsSync(o.工作目录)) throw new Error(`工作目录不存在：${o.工作目录}（不许默默兜底成某个家，那才是 11-05 那次的坑）`);
  }
  const 回执 = require(关任务窗).回执路径(任务文件);

  // ── ① 查窗（只读，干跑也做）──
  const 窗 = 查窗(o.人);
  if (窗.解析失败) throw new Error(`查对端窗认不出「${o.人}」：${窗.原文}（多半是名字跟通讯录对不上）`);

  // 正文：给的是文件就按文件发（长文/反引号/换行不吃 shell）
  let 正文文件 = null;
  const 可能是文件 = path.resolve(仓根, o.正文);
  const 从文件 = fs.existsSync(可能是文件) && fs.statSync(可能是文件).isFile();
  const 正文 = 从文件 ? fs.readFileSync(可能是文件, "utf8") : o.正文;
  const 尾注 = [
    "",
    "——",
    `任务书：${path.relative(仓根, 任务文件) || 任务文件}`,
    `回执写：${path.relative(仓根, 回执)}（落地会自动关任务窗；回执里写清干了什么、证据在哪、没干成卡在哪）`,
    "不用发企微，回执落地就行。",
  ].join("\n");
  const 要发 = 正文.replace(/\s+$/, "") + "\n" + 尾注 + "\n";

  const 等回执命令 = `node "0.木婉清档案/等回执.cjs" "${path.relative(档, 回执)}" ${o.等}`;

  // ── 打印计划（干跑只看这一屏） ──
  console.log("── 派活计划 ──");
  if (窗.在) console.log(`① 查窗：「${o.人}」在跑 pid=${窗.pid} → 不发开窗命令，直接发信`);
  else console.log(`① 查窗：「${o.人}」不在 → 需要开任务窗${o.工作目录 ? `（${o.工作目录}）` : "（⚠ 还没给 --工作目录）"}`);
  console.log(`② 私信给「${o.人}」，正文：`);
  for (const 行 of 要发.trimEnd().split("\n")) console.log(`   | ${行}`);
  console.log(`③ 回执：${回执}`);
  console.log(`   等回执：${等回执命令}`);
  if (o.干) { console.log("\n（--干：只查了窗，没开窗、没发信）"); return 0; }

  // ── ② 窗不在 → 开任务窗，并确认它真的起来了 ──
  let 新开pid = "";
  if (!窗.在) {
    if (!o.工作目录) throw new Error("对方窗不在，要开任务窗就必须给 --工作目录（对方家的绝对路径）；不给就不派——不许兜底开在谁家");
    const 参 = [开任务窗, 任务文件, o.工作目录];
    if (o.不收窗) 参.push("--不收窗");
    const r = spawnSync(process.execPath, 参, { cwd: 档, encoding: "utf8", timeout: 180000 });
    const 出 = `${r.stdout || ""}${r.stderr || ""}`.trim();
    console.log("\n" + 出);
    if (r.status !== 0) {
      console.error(`\n✗ 开任务窗失败（退出码 ${r.status}）：窗没起来，信也没发。`);
      return 3;
    }
    新开pid = (出.match(/任务窗进程号：(\d+)/) || [])[1] || "";
    // 进程刚起要一两秒才在命令行里出现：最多等 12 秒，不空转、不无限等
    let 起来 = false;
    for (let i = 0; i < 8 && !起来; i += 1) {
      await 睡(1500);
      起来 = 查任务窗(任务文件, o.工作目录).活着;
    }
    if (!起来) {
      console.error(`\n✗ 窗没起来（pid ${新开pid || "没读到"}，12 秒内没在进程表里认到）：信没发。`);
      console.error("  查：node \"0.木婉清档案/关任务窗.cjs\" --看");
      return 3;
    }
    console.log(`✓ 任务窗已确认在跑${新开pid ? `（pid ${新开pid}）` : ""}`);
  }

  // ── ③ 发私信（复用配额闸，不另写）──
  fs.mkdirSync(临时目录, { recursive: true });
  正文文件 = path.join(临时目录, `派活-${Date.now()}.txt`);
  fs.writeFileSync(正文文件, 要发, "utf8");
  const r2 = spawnSync(process.execPath, [私信, o.人, "--从文件", 正文文件], { cwd: 仓根, encoding: "utf8", timeout: 180000 });
  const 出2 = `${r2.stdout || ""}${r2.stderr || ""}`.trim();
  console.log("\n" + 出2);
  if (r2.status !== 0) {
    console.error(`\n✗ 私信没发出去（退出码 ${r2.status}）：不重试、不换人。`);
    if (r2.status === 6) console.error("  6＝配额闸：同人同日第 3 封起必须 --连发 --理由。确实是新一轮活，就按提示补理由重发一次。");
    if (r2.status === 2) console.error("  2＝收件人解析不到：名字要跟通讯录一致。");
    return 4;
  }

  console.log("\n✓ 派活完成");
  console.log(`  窗：${窗.在 ? `原有 pid=${窗.pid}` : `新开${新开pid ? ` pid=${新开pid}` : ""}（已确认在跑）`}`);
  console.log(`  私信：已发并回读一致`);
  console.log(`  回执：${回执}`);
  console.log(`  等回执：${等回执命令}`);
  return 0;
}

if (require.main === module) {
  Promise.resolve()
    .then(主)
    .then((码) => { process.exitCode = 码; })
    .catch((e) => {
      console.error("✗ " + (e && e.message ? e.message : e));
      process.exitCode = 2;
    });
}
module.exports = { 解析, 查窗, 查任务窗 };
