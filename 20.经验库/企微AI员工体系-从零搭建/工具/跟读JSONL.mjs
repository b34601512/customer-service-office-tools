#!/usr/bin/env node
// 跟读 JSONL：追加型文件长出新行就打印一行 —— 用来接 AI 运行时的「监视输出 → 唤醒」机制。
//
// 为什么不用定时轮询：轮询要么慢、要么费；「文件长出新行才输出」是事件式的——
// 平时保持安静（没新消息不输出，避免假唤醒），有消息就是秒级。
//
// 用法：
//   node 跟读JSONL.mjs <文件> [--从头] [--间隔 1500] [--字段 at,fromName,text] [--前缀 【新消息】]
//
// 行为：
//   - 默认从文件末尾开始跟（已有内容不打印）；--从头 先打印已有行再继续跟（调试用）；
//   - 只打完整的行；写到一半的行留着，等换行补齐再打（不撕半条消息）；
//   - 文件被清空/轮转（变小）→ 自动从头重新跟；
//   - 文件还不存在也没关系，等它出现。
//
// 出口约定（给 AI runtime 用）：有新行 → 标准输出一行；没新行 → 一个字都不输出。
// 这样把它挂在「后台命令输出触发事件」的监视器上，一有新行就叫醒 AI，安静时不叫。
//
// 依赖：Node ≥ 18，零第三方依赖。无任何网络访问、不修改被跟读的文件（只读）。

import fs from "node:fs";

/** 从 偏移 处读出新增的完整行；返回新偏移（半个行不读，留到下一轮）。 */
export function 读新字节(路径, 偏移) {
  const 大小 = fs.existsSync(路径) ? fs.statSync(路径).size : 0;
  if (大小 < 偏移) 偏移 = 0; // 文件被清空/轮转过：从头再来
  if (大小 === 偏移) return { 偏移, 行: [] };
  const fd = fs.openSync(路径, "r");
  const buf = Buffer.alloc(大小 - 偏移);
  try {
    fs.readSync(fd, buf, 0, buf.length, 偏移);
  } finally {
    fs.closeSync(fd);
  }
  const 切开 = buf.toString("utf8").split("\n");
  const 尾 = 切开.pop() || ""; // 最后一段没有换行 = 半个行，不读
  return { 偏移: 大小 - Buffer.byteLength(尾, "utf8"), 行: 切开.filter((l) => l.trim()) };
}

/** 一行原文 → 给人看的一行；给了字段名就只抽那几个字段（值截断，防刷屏）。 */
export function 格式化(line, 字段 = [], 前缀 = "【新行】") {
  if (!字段.length) return line;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return `${前缀}（读不出来的一行）${String(line).slice(0, 120)}`;
  }
  const 件 = [];
  for (const k of 字段) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") {
      const v = typeof o[k] === "object" ? JSON.stringify(o[k]) : String(o[k]);
      件.push(`${k}=${v.length > 120 ? v.slice(0, 120) + "…" : v}`);
    }
  }
  return `${前缀} ${件.join(" ")}`.trimEnd();
}

function 取参数(argv) {
  const 出 = { 文件: "", 从头: false, 间隔: 1500, 字段: [], 前缀: "【新行】" };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--从头") 出.从头 = true;
    else if (k === "--间隔") { 出.间隔 = Math.max(200, Number(argv[i + 1]) || 1500); i += 1; }
    else if (k === "--字段") { 出.字段 = String(argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (k === "--前缀") { 出.前缀 = String(argv[i + 1] || "【新行】"); i += 1; }
    else if (k === "--help" || k === "-h") { 出.帮助 = true; }
    else if (!出.文件) 出.文件 = k;
  }
  return 出;
}

function 主流程() {
  const 参 = 取参数(process.argv.slice(2));
  if (参.帮助 || !参.文件) {
    console.log("用法：node 跟读JSONL.mjs <文件> [--从头] [--间隔 1500] [--字段 a,b,c] [--前缀 【新行】]");
    process.exit(参.帮助 ? 0 : 2);
  }
  let 偏移 = 参.从头 ? 0 : (fs.existsSync(参.文件) ? fs.statSync(参.文件).size : 0);
  const 跟 = () => {
    const 果 = 读新字节(参.文件, 偏移);
    偏移 = 果.偏移;
    for (const l of 果.行) console.log(格式化(l, 参.字段, 参.前缀));
  };
  if (参.从头) 跟(); // 先把已有的打一遍
  setInterval(跟, 参.间隔);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("跟读JSONL.mjs")) 主流程();
