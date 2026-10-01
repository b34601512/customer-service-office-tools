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

/** 从 `--核对` 输出里读「哪些文件还有真值」：行形如 `   path/to/f.md 里有真值「x」` */
function 解析含真值文件(text) {
  const 集 = new Set();
  for (const 行 of String(text).split("\n")) {
    const m = 行.match(/^\s*(.+?)\s+里有真值/);
    if (m) 集.add(m[1].trim());
  }
  return [...集];
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

  // 2b) 学完之后：**已入库但含真值**的文件也要补打码（否则本次提交后 `--核对` 仍会红字）。
  //     安全线：只动「工作区 == HEAD」的文件——有未提交改动的文件一律不碰（那是别的会话正在写的，不能吞）。
  try {
    const 核对前 = 跑("node", ["tools/打码.js", "--核对"]);
    void 核对前;
  } catch (e) {
    const 脏文件 = 解析含真值文件(String(e.stdout || ""));
    const 可补 = [];
    const 跳过 = [];
    for (const f of 脏文件) {
      try {
        execFileSync("git", ["diff", "--quiet", "HEAD", "--", f], { cwd: 仓库根, stdio: "ignore" });
        可补.push(f); // 退出 0 = 工作区与 HEAD 一致 → 可以安全补打码
      } catch { 跳过.push(f); }
    }
    if (可补.length) {
      console.log(`[提交闸门] 有 ${可补.length} 个已入库文件含明文真值 → 先补打码（不碰工作区有改动的文件）`);
      跑("git", ["add", "--renormalize", "--", ...可补]);
    }
    if (跳过.length) {
      console.log(`[提交闸门] ⚠ 这些文件含真值但工作区有未提交改动，**不自动动**（请人工处理）：${跳过.join("、")}`);
    }
  }

  // 3) 点名文件：先筛掉 .gitignore 忽略的（私有目录不入库，只警告不报错）
  const 入库 = [];
  const 忽略 = [];
  for (const f of 文件) {
    try {
      execFileSync("git", ["check-ignore", "-q", "--", f], { cwd: 仓库根, stdio: "ignore" });
      忽略.push(f); // 退出 0 = 被忽略
    } catch { 入库.push(f); }
  }
  if (忽略.length) console.log(`[提交闸门] ⚠ 这些文件被 .gitignore 忽略，跳过（私有/业务数据不入库）：${忽略.join("、")}`);
  if (!入库.length) throw new Error("点名文件全被 .gitignore 忽略，没有可提交的内容");

  // 先 add（新文件也要进暂存区）
  跑("git", ["add", "--", ...入库]);
  // 再 --renormalize，但**只对已在 HEAD 的文件**（新文件 renormalize 会 fatal: not in 'HEAD'）
  const 已跟踪 = 入库.filter((f) => {
    try { execFileSync("git", ["cat-file", "-e", `HEAD:${f}`], { cwd: 仓库根, stdio: "ignore" }); return true; }
    catch { return false; }
  });
  if (已跟踪.length) 跑("git", ["add", "--renormalize", "--", ...已跟踪]);

  // 4) 提交
  const 提交输出 = 跑("git", ["commit", "-m", 信息, "--", ...入库]);
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

module.exports = { 解析未学数, 解析参数, 解析含真值文件 };
