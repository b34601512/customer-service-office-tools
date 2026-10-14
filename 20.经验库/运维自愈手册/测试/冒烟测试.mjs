#!/usr/bin/env node
"use strict";
/**
 * 冒烟测试.mjs —— 自巡查.cjs 的独立复跑测试（不依赖公司环境，任何 Windows 机器可跑）
 *
 *   node 测试\冒烟测试.mjs
 *
 * 覆盖：
 *   1 无配置 → exit 2
 *   2 非法正则 → exit 2
 *   3 干看：目标不在 → 报 [不在]
 *   4 真跑：不在 → 自动拉起 → 进程真的起来（再干看为「在」）
 *   5 边界：只存在「装假XX.cjs」时，带边界的 match 不误命中
 *   6 卡死检查：进程在但日志超时未更新 → 报 [卡死?]
 *   7 日志：真跑后日志文件生成、含「拉起」
 * 测试进程全部落在临时目录（杀进程只按临时目录特征杀，安全）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BASE = path.resolve(import.meta.dirname, "..");
const 工具 = path.join(BASE, "工具", "自巡查.cjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "自巡查测试-"));
const 假常驻 = path.join(TMP, "假常驻.cjs");
const 假僵死 = path.join(TMP, "假僵死.cjs");
const 假常驻日志 = path.join(TMP, "假常驻.log");
const 假僵死日志 = path.join(TMP, "假僵死.log");
const 配置 = path.join(TMP, "测试配置.json");
const 日志 = path.join(TMP, "自巡查.log");

fs.writeFileSync(假常驻, [
  'const fs = require("fs"); const path = require("path");',
  'setInterval(() => { try { fs.appendFileSync(path.join(__dirname, "假常驻.log"), new Date().toISOString() + "\\n"); } catch {} }, 500);',
  ""
].join("\n"));
fs.writeFileSync(假僵死, 'setInterval(() => {}, 1000);\n');
fs.writeFileSync(path.join(TMP, "装修假常驻.cjs"), 'setInterval(() => {}, 1000);\n');
fs.writeFileSync(假常驻日志, "init\n");
fs.writeFileSync(假僵死日志, "init\n");

const 带边界 = (名) => `(^|[\\\\/\\s"])${名}[.]cjs`;
fs.writeFileSync(配置, JSON.stringify({
  log: 日志,
  tasks: [
    { name: "假常驻", match: 带边界("假常驻"), exe: process.execPath, args: [假常驻], hide: true },
    { name: "假僵死", match: 带边界("假僵死"), exe: process.execPath, args: [假僵死], hide: true,
      staleLog: { path: 假僵死日志, maxAgeMin: 1 } }
  ]
}, null, 2));

function run(...args) {
  return spawnSync(process.execPath, [工具, ...args], { encoding: "utf8", windowsHide: true, timeout: 120000 });
}
function 起假进程(脚本, 特征) {
  // 用 PowerShell Start-Process 起（跟自巡查同款，进程独立；离开测试进程也能活）
  const 脚本2 = [
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;",
    `$p = Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList '"${脚本.replace(/'/g, "''")}"' -WindowStyle Hidden -PassThru;`,
    "Write-Output $p.Id"
  ].join(" ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", 脚本2], { encoding: "utf8", windowsHide: true });
  return Number(String(r.stdout || "").trim().split(/\s+/).pop()) || 0;
}
function 杀含tmp的node进程() {
  const 关键词 = TMP.replace(/'/g, "''");
  const 脚本 = [
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;",
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${关键词}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
  ].join(" ");
  spawnSync("powershell.exe", ["-NoProfile", "-Command", 脚本], { encoding: "utf8", windowsHide: true });
}
const 等 = (毫秒) => new Promise((r) => setTimeout(r, 毫秒));

let 过 = 0, 败 = 0;
function 断言(名, 条件, 详情 = "") {
  if (条件) { 过++; console.log(`  ✅ ${名}`); }
  else { 败++; console.log(`  ❌ ${名} ${详情}`); }
}

try {
  console.log(`临时目录：${TMP}\n`);

  console.log("1) 无配置 → exit 2");
  {
    const r = run("--配置", path.join(TMP, "不存在.json"));
    断言("exit=2 且给提示", r.status === 2 && /读不到配置/.test(r.stderr + r.stdout));
  }

  console.log("2) 非法正则 → exit 2");
  {
    const 坏 = path.join(TMP, "坏配置.json");
    fs.writeFileSync(坏, JSON.stringify({ tasks: [{ name: "x", match: "(", exe: "node" }] }));
    const r = run("--配置", 坏);
    断言("exit=2 且报正则错", r.status === 2 && /不是合法正则/.test(r.stderr + r.stdout));
  }

  console.log("3) 干看：目标不在 → [不在]");
  {
    const r = run("--配置", 配置, "--干看");
    const out = r.stdout + r.stderr;
    断言("报假常驻不在", /\[不在\] 假常驻/.test(out));
    断言("退出码 1（有问题）", r.status === 1, `status=${r.status}`);
  }

  console.log("4) 真跑：不在 → 自动拉起 → 进程真的起来");
  {
    const r = run("--配置", 配置);
    const out = r.stdout + r.stderr;
    断言("日志报拉起", /\[拉起\] 假常驻 → pid=\d+/.test(out), out.split("\n")[0]);
    await 等(1500);
    const r2 = run("--配置", 配置, "--干看");
    const out2 = r2.stdout + r2.stderr;
    断言("再干看为「在」", /\[在\] 假常驻/.test(out2) && !/\[拉起\] 假常驻/.test(out2));
  }

  console.log("5) 边界：只有「装假常驻.cjs」进程时，不误命中「假常驻.cjs」");
  {
    杀含tmp的node进程(); await 等(800);
    起假进程(path.join(TMP, "装修假常驻.cjs"), "装"); await 等(1000);
    const r = run("--配置", 配置, "--干看");
    const out = r.stdout + r.stderr;
    断言("仍报假常驻 [不在]（没被装修版骗）", /\[不在\] 假常驻/.test(out));
    杀含tmp的node进程(); await 等(800);
  }

  console.log("6) 卡死检查：进程在、日志超时未更新 → [卡死?]");
  {
    const pid = 起假进程(假僵死, "僵"); await 等(1200);
    断言("假僵死进程已起", pid > 0, `pid=${pid}`);
    // 把日志做旧（3 分钟前）
    const 旧 = new Date(Date.now() - 3 * 60 * 1000);
    fs.utimesSync(假僵死日志, 旧, 旧);
    const r = run("--配置", 配置, "--干看");
    const out = r.stdout + r.stderr;
    断言("报 [卡死?]", /\[卡死\?\] 假僵死/.test(out), out);
    断言("退出码 1", r.status === 1, `status=${r.status}`);
  }

  console.log("7) 日志文件：真跑后生成、含拉起记录");
  {
    断言("自巡查.log 存在", fs.existsSync(日志));
    const 内容 = fs.existsSync(日志) ? fs.readFileSync(日志, "utf8") : "";
    断言("含「拉起」记录", /拉起/.test(内容));
  }
} finally {
  杀含tmp的node进程();
}

console.log(`\n结果：${过} 过 / ${败} 败`);
process.exit(败 ? 1 : 0);
