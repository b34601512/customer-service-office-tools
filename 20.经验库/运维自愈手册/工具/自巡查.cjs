#!/usr/bin/env node
"use strict";
/**
 * 自巡查.cjs —— 「关键常驻进程不在就拉起」通用巡查器（只读＋拉起，不杀不写业务数据）
 *
 *   node 自巡查.cjs                    # 跑一轮：不在就拉起；日志不新鲜就记警
 *   node 自巡查.cjs --干看              # 只报告，不动作、不写日志（试配置用）
 *   node 自巡查.cjs --配置 我的.json    # 指定配置（默认：同目录 自巡查.json）
 *   node 自巡查.cjs --帮助
 *
 * 配置示例见同目录 自巡查.example.json。要点：
 *   - match：进程命令行正则，**务必带边界**（别用裸子串——曾把「装叫醒器.cjs」误认成「叫醒器.cjs」）；
 *   - exe/args：不在时的拉起方式（走 PowerShell Start-Process，进程独立、可隐藏）；
 *   - staleLog（可选）：进程在、但日志超过 N 分钟没动 → 记「疑似卡死」警（只记警不杀进程，防误伤）。
 *
 * 用法：交给 Windows 计划任务每 5 分钟调一次（或你熟悉的任意定时器）。
 * 设计出处：真实事故——手动常驻的进程活不过机器重启，整个「按需叫醒」链断了没人知道。
 *          对策＝定期巡查＋不在就拉起（见《运维自愈手册》原则 2、案例 1）。
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ---------- 参数 ----------
const ARGV = process.argv.slice(2);
if (ARGV.includes("--帮助") || ARGV.includes("--help") || ARGV.includes("-h")) {
  console.log([
    "用法：node 自巡查.cjs [--干看] [--配置 文件.json]",
    "  --干看   只报告，不拉起、不写日志",
    "  --配置   默认同目录 自巡查.json",
    ""
  ].join("\n"));
  process.exit(0);
}
const 干看 = ARGV.includes("--干看");
const 配置位 = ARGV.indexOf("--配置");
const 配置路径 = path.resolve(配置位 >= 0 && ARGV[配置位 + 1] ? ARGV[配置位 + 1] : path.join(__dirname, "自巡查.json"));

// ---------- 配置 ----------
let 配置;
try {
  配置 = JSON.parse(fs.readFileSync(配置路径, "utf8"));
} catch (e) {
  console.error(`读不到配置：${配置路径}`);
  console.error("（首次使用：把 自巡查.example.json 拷成 自巡查.json 按自家的进程改。）");
  process.exit(2);
}
const 任务 = Array.isArray(配置.tasks) ? 配置.tasks : [];
if (!任务.length) {
  console.error("配置里没有 tasks。");
  process.exit(2);
}
for (const t of 任务) {
  if (!t || !t.name || !t.match || !t.exe) {
    console.error(`任务配置不全（需要 name/match/exe）：${JSON.stringify(t)}`);
    process.exit(2);
  }
  try { new RegExp(t.match); } catch (e) {
    console.error(`任务「${t.name}」的 match 不是合法正则：${t.match}`);
    process.exit(2);
  }
}

// ---------- 日志 ----------
const 日志路径 = path.resolve(path.dirname(配置路径), 配置.log || "自巡查.log");
function 记(行) {
  if (干看) return;
  try {
    fs.mkdirSync(path.dirname(日志路径), { recursive: true });
    try {
      if (fs.statSync(日志路径).size > 1024 * 1024) fs.renameSync(日志路径, 日志路径 + ".1");
    } catch { /* 不存在就算了 */ }
    const t = new Date().toLocaleString("zh-CN", { hour12: false });
    fs.appendFileSync(日志路径, `[${t}] ${行}\n`, "utf8");
  } catch { /* 记不上也别崩 */ }
}
function 报(行) { console.log(行); }

// ---------- 进程表（PowerShell 全表，中文路径强制 UTF-8） ----------
function 进程表() {
  const 脚本 = [
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;",
    "$ErrorActionPreference='SilentlyContinue';",
    "Get-CimInstance Win32_Process | ForEach-Object {",
    "  $cl=$_.CommandLine; if ($null -eq $cl) { $cl='' };",
    "  Write-Output ($_.ProcessId.ToString()+'|'+$_.Name+'|'+$cl)",
    "}"
  ].join(" ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", 脚本], {
    encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024
  });
  if (r.status !== 0 || !r.stdout) {
    return { 错: (r.stderr || r.error || "PowerShell 查询失败").toString().trim(), 列表: [] };
  }
  const 列表 = [];
  for (const 行 of r.stdout.split(/\r?\n/)) {
    const i1 = 行.indexOf("|"); if (i1 <= 0) continue;
    const i2 = 行.indexOf("|", i1 + 1);
    if (i2 < 0) continue;
    const pid = Number(行.slice(0, i1)); if (!pid) continue;
    const name = 行.slice(i1 + 1, i2);
    const cl = 行.slice(i2 + 1).replace(/\//g, "\\").toLowerCase(); // 斜杠归一、小写
    列表.push({ pid, name, cl });
  }
  return { 错: null, 列表 };
}

// ---------- 拉起（PowerShell Start-Process：新进程组，脚本退出不影响它） ----------
function ps单引号(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }
function 拉起(exe, args, hide) {
  const 参数串 = (args || []).map((a) => '"' + String(a).replace(/"/g, '\\"') + '"').join(" ");
  const 脚本 = [
    "$ErrorActionPreference='Stop';",
    `$p = Start-Process -FilePath ${ps单引号(exe)}` + (参数串 ? ` -ArgumentList ${ps单引号(参数串)}` : "") +
      (hide === false ? "" : " -WindowStyle Hidden") + " -PassThru;",
    "Write-Output $p.Id"
  ].join(" ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", 脚本], {
    encoding: "utf8", windowsHide: true, timeout: 60000
  });
  if (r.status !== 0) return { ok: false, 错: (r.stderr || r.error || "Start-Process 失败").toString().trim() };
  const pid = Number(String(r.stdout).trim().split(/\s+/).pop());
  return { ok: true, pid: Number.isFinite(pid) ? pid : 0 };
}

// ---------- 主流程 ----------
const { 错, 列表 } = 进程表();
if (错) { 报(`进程表查询失败：${错}`); 记(`进程表查询失败：${错}`); process.exit(1); }

let 问题 = 0;
const 摘要 = [];
for (const t of 任务) {
  const re = new RegExp(t.match, "i");
  const 命中 = 列表.filter((p) => re.test(p.cl));
  if (命中.length) {
    摘要.push(`${t.name} 在(${命中.map((p) => p.pid).join(",")})`);
    if (干看) 报(`[在] ${t.name}（pid=${命中.map((p) => p.pid).join(",")}）`);
    // 可选：日志新鲜度（进程在也可能卡死）
    if (t.staleLog && t.staleLog.path && t.staleLog.maxAgeMin > 0) {
      try {
        const 分 = Math.round((Date.now() - fs.statSync(t.staleLog.path).mtimeMs) / 60000);
        if (分 > t.staleLog.maxAgeMin) {
          问题++;
          报(`[卡死?] ${t.name}：进程在，但日志 ${分} 分钟没更新（阈值 ${t.staleLog.maxAgeMin}）——${t.staleLog.path}`);
          记(`${t.name}：疑似卡死（日志 M 不动 ${分} 分钟，阈值 ${t.staleLog.maxAgeMin}）`);
        }
      } catch { /* 日志不存在＝也算没动过？这里保守不报，避免刚装的误报 */ }
    }
  } else {
    if (干看) {
      问题++;
      摘要.push(`${t.name} 不在`);
      报(`[不在] ${t.name}（match=${t.match}）`);
      记(`${t.name}：不在（干看，不动作）`);
    } else {
      const r = 拉起(t.exe, t.args || [], t.hide);
      if (r.ok) { 摘要.push(`${t.name} 拉起→${r.pid}`); 报(`[拉起] ${t.name} → pid=${r.pid}`); 记(`${t.name}：不在 → 拉起 pid=${r.pid}`); }
      else { 问题++; 摘要.push(`${t.name} 拉起失败`); 报(`[拉起失败] ${t.name}：${r.错}`); 记(`${t.name}：不在 → 拉起失败：${r.错}`); }
    }
  }
}
记(`一轮：${问题 ? 问题 + " 个问题；" : "全部正常；"}${摘要.join(" | ")}`);
if (!问题) 报(`全部正常（${摘要.length} 项）`);
process.exit(问题 ? 1 : 0);
