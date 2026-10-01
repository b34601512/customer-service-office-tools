#!/usr/bin/env node
/**
 * 提交闸门：把「打码」从"记得做"变成"绕不过去"。
 *
 * 为什么存在（2026-10-01 第二次踩坑）：打码过滤器只对**对照表里的真值**生效。
 * 顺序错了就会把订单号/快递单号明文推到 GitHub：
 *   先 `git add` → 提交（此时真值还没进对照表）→ 才想起 `--学` → 明文已经上路。
 * 本脚本把顺序**固定**成：扫描 →（有新的就）`--学` → `git add --renormalize` → 提交 → `--核对`。
 *
 * 用法：
 *   node tools/提交.js -m "提交信息" <文件1> <文件2> ...
 *
 * 规矩：
 *   · **必须点名文件**（禁止 `git add -A` / `-u`：本仓库常有平行会话在同时改代码）；
 *   · 有新的真值自动 `--学`（进本机对照表 `tools/打码对照.local`，不入库）；
 *   · `git add --renormalize` 保证过滤器对**已存在但没打码**的文件重新生效；
 *   · 提交后自动 `--核对`，不干净会红字报出来。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const 仓库根 = path.resolve(__dirname, "..");

/** 从 `--扫描` 输出里读「其中 N 个还没进对照表」 */
function 解析未学数(text) {
  const m = String(text).match(/其中\s*(\d+)\s*个还没进对照表/);
  return m ? Number(m[1]) : 0;
}

/** 解析 `-m "信息"`；返回 { 信息, 文件 }；文件必须显式点名 */
function 解析参数(argv) {
  let 信息 = null;
  const 文件 = [];
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "-m" || t === "--message") { 信息 = argv[i + 1] ?? null; i += 1; continue; }
    if (t.startsWith("-")) throw new Error(`不认识的参数：${t}（本脚本只支持 -m "信息" + 点名文件）`);
    文件.push(t);
  }
  if (!信息) throw new Error('缺少提交信息：node tools/提交.js -m "信息" <文件...>');
  if (!文件.length) throw new Error("必须点名要提交的文件（禁止 git add -A / -u：平行会话可能正在改别的文件）");
  return { 信息, 文件 };
}

function 跑(命令, 参数) {
  return execFileSync(命令, 参数, { cwd: 仓库根, encoding: "utf8" });
}

function main() {
  const { 信息, 文件 } = 解析参数(process.argv.slice(2));

  // 1) 扫描：仓库里还有哪些真值、有多少还没进对照表
  let 扫描输出 = "";
  try { 扫描输出 = 跑("node", ["tools/打码.js", "--扫描"]); }
  catch (e) { 扫描输出 = String(e.stdout || ""); }
  const 未学 = 解析未学数(扫描输出);

  // 2) 有新的真值 → 先学（否则过滤器不认识它们，明文就会被推上去）
  if (未学 > 0) {
    console.log(`[提交闸门] 有 ${未学} 个真值还没进对照表 → 先 --学`);
    跑("node", ["tools/打码.js", "--学"]);
  }

  // 3) 点名文件：先 add（新文件也要进暂存区），再 --renormalize
  //    （renormalize 只作用于**已跟踪**文件：让过滤器对"已在库里但没打码"的内容重新生效）
  跑("git", ["add", "--", ...文件]);
  跑("git", ["add", "--renormalize", "--", ...文件]);

  // 4) 提交
  const 提交输出 = 跑("git", ["commit", "-m", 信息, "--", ...文件]);
  console.log(提交输出.split("\n")[0]);

  // 5) 核对：HEAD 里还有没有真值
  let 核对输出 = "";
  try { 核对输出 = 跑("node", ["tools/打码.js", "--核对"]); process.exitCode = 0; }
  catch (e) { 核对输出 = String(e.stdout || ""); process.exitCode = 1; }
  console.log(核对输出.trim().split("\n").slice(-3).join("\n"));
  if (process.exitCode) {
    console.log('[提交闸门] 核对没过：说明这次提交里还有明文真值 → 修法：node tools/打码.js --学 后');
    console.log('            git add --renormalize <文件> && git commit --amend --no-edit && git push --force-with-lease');
  } else {
    console.log("[提交闸门] 通过：可以 push 了（git push）");
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`[提交闸门] 失败：${e.message}`); process.exitCode = 2; }
}

module.exports = { 解析未学数, 解析参数 };
