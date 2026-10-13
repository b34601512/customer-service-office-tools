#!/usr/bin/env node
// 游标读 JSONL：只读「上次之后」的新行 —— 消息不重复处理、也不漏；读完推进游标（--mark）。
//
// 设计：
//   - 游标默认存在 <数据文件>.游标.json（记「偏移」= 已读到第几字节；不进 git）；
//   - 默认只读只显示（dry），--mark 才推进游标 —— 先看清楚再盖章，防手滑漏消息；
//   - 半个行（没换行结尾）不算读掉，等补齐再算；
//   - 文件被清空/轮转（比游标短）→ 游标重置为 0，从头读。
//
// 用法：
//   node 读JSONL游标.mjs <文件>                  # 看新行（不动游标）
//   node 读JSONL游标.mjs <文件> --mark           # 看新行并推进游标（处理完再盖）
//   node 读JSONL游标.mjs <文件> --all            # 从头看全部（不动游标）
//   node 读JSONL游标.mjs <文件> --tail 3         # 只看新行里的最后 3 条（--mark 仍推进到末尾）
//   node 读JSONL游标.mjs <文件> --字段 at,text   # 只抽字段显示（默认原样打整行）
//   node 读JSONL游标.mjs <文件> --游标 <路径>    # 自定义游标文件位置
//
// 出口约定：有新的完整行才输出；没有就一个字不输出（方便挂自动化）。
// 依赖：Node ≥ 18，零第三方依赖；只读数据文件。

import fs from "node:fs";

/** 读游标文件 → 字节偏移（缺文件/坏文件按 0）。 */
export function 读游标(游标路径) {
  try {
    const j = JSON.parse(fs.readFileSync(游标路径, "utf8"));
    const n = Number(j && j.偏移);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** 写游标文件（带更新时间，方便排查）。 */
export function 写游标(游标路径, 偏移) {
  fs.mkdirSync(游标路径.replace(/[/\\][^/\\]*$/, "") || ".", { recursive: true });
  fs.writeFileSync(游标路径, JSON.stringify({ 偏移, 更新时间: new Date().toISOString() }, null, 2) + "\n", "utf8");
}

/** 从 偏移 处读出新增的完整行；返回可推进到的偏移（半个行不算）。 */
export function 读新行(路径, 偏移) {
  const 大小 = fs.existsSync(路径) ? fs.statSync(路径).size : 0;
  if (大小 < 偏移) 偏移 = 0; // 文件变短 = 轮转过，从头读
  if (大小 === 偏移) return { 到偏移: 偏移, 行: [] };
  const fd = fs.openSync(路径, "r");
  const buf = Buffer.alloc(大小 - 偏移);
  try {
    fs.readSync(fd, buf, 0, buf.length, 偏移);
  } finally {
    fs.closeSync(fd);
  }
  const 切开 = buf.toString("utf8").split("\n");
  const 尾 = 切开.pop() || ""; // 半个行：留到下一轮
  return { 到偏移: 大小 - Buffer.byteLength(尾, "utf8"), 行: 切开.filter((l) => l.trim()) };
}

function 取参数(argv) {
  const 出 = { 文件: "", 游标: "", mark: false, all: false, tail: 0, 字段: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--mark") 出.mark = true;
    else if (k === "--all") 出.all = true;
    else if (k === "--tail") { 出.tail = Math.max(0, Number(argv[i + 1]) || 0); i += 1; }
    else if (k === "--字段") { 出.字段 = String(argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (k === "--游标") { 出.游标 = String(argv[i + 1] || ""); i += 1; }
    else if (k === "--help" || k === "-h") 出.帮助 = true;
    else if (!出.文件) 出.文件 = k;
  }
  return 出;
}

function 格式化(line, 字段) {
  if (!字段.length) return line;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return `（读不出来的一行）${String(line).slice(0, 120)}`;
  }
  return 字段
    .filter((k) => o && o[k] !== undefined && o[k] !== null && o[k] !== "")
    .map((k) => {
      const v = typeof o[k] === "object" ? JSON.stringify(o[k]) : String(o[k]);
      return `${k}=${v.length > 120 ? v.slice(0, 120) + "…" : v}`;
    })
    .join(" ");
}

function 主流程() {
  const 参 = 取参数(process.argv.slice(2));
  if (参.帮助 || !参.文件) {
    console.log("用法：node 读JSONL游标.mjs <文件> [--游标 <路径>] [--mark] [--all] [--tail N] [--字段 a,b,c]");
    process.exit(参.帮助 ? 0 : 2);
  }
  const 游标路径 = 参.游标 || `${参.文件}.游标.json`;
  const 起点 = 参.all ? 0 : 读游标(游标路径);
  const 果 = 读新行(参.文件, 起点);
  const 要打 = 参.tail > 0 ? 果.行.slice(-参.tail) : 果.行;
  for (const l of 要打) console.log(格式化(l, 参.字段));
  if (参.mark) 写游标(游标路径, 果.到偏移);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("读JSONL游标.mjs")) 主流程();
