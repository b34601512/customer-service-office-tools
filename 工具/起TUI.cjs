#!/usr/bin/env node
"use strict";
/**
 * 起别人的 TUI —— 只走这里，一条命令。
 *
 * 为什么有这个文件（2026-11-25 黎路遥：「如何避免后续继续这样胡搞瞎搞」）：
 *   那天的实际经过：好好的发票 TUI 已经在跑，我嫌它开在一个标签里，就手拼 wt 参数重起；
 *   bash→node→powershell 一路转义，反斜杠被吃掉，`-d` 变成 "D:\桌面\木婉清\硅基公司员工.发票专员…"，
 *   wt 报 0x8007010b，窗没开；我又反复试了三次，还先把在跑的进程杀了。
 *   三条教训写进这个工具，让「错」跑不起来：
 *     ① 起 TUI 一律用**人家自己的启动脚本**（.bat / .cjs），本文件只负责按正确方式调它，绝不自己拼 wt 参数；
 *     ② 起之前先看**在不在跑**：在跑就报 pid 并停手，不重复起、不杀；
 *     ③ 起完要**自证**：等几秒确认进程真出现了，报 pid；没出现就把启动脚本的原样输出打出来。
 *
 * 用法：
 *   node 工具/起TUI.cjs --看           # 列表 + 现在在不在跑
 *   node 工具/起TUI.cjs 发票           # 起（已在跑则只报 pid，不动）
 *   node 工具/起TUI.cjs 5号 --强制      # 明知在跑也要再起一扇（极少用；不杀旧的）
 *
 * 退出码：0＝已在跑或起成功；1＝没认出来／起失败。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const 配置路径 = path.join(__dirname, "起TUI.json");
const 配置 = JSON.parse(fs.readFileSync(配置路径, "utf8"));

function 跑(cmd, args, opts) {
  return spawnSync(cmd, args, { encoding: "utf8", timeout: 60000, ...opts });
}

/** 用命令行里的特征串找进程（只读，不动别人） */
function 找进程(特征) {
  const ps = 跑("powershell.exe", [
    "-NoProfile",
    "-Command",
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${特征}*' -and $_.Name -notlike 'bash*' -and $_.Name -notlike 'powershell*' -and $_.Name -notlike 'cmd.exe' } | Select-Object ProcessId,Name`,
  ]);
  const 行 = (ps.stdout || "").split("\n").map((x) => x.trim()).filter((x) => /^\d/.test(x));
  return 行.map((x) => {
    const [pid, name] = x.split(/\s+/);
    return { pid: Number(pid), name };
  });
}

/**
 * 用可见顶层窗口标题找窗口（进程命令行认不出目标时的兜底）。
 * 为什么加：5号 TUI 的命令行只有 `python.exe cli.py`，不带目录名——2026-11-26
 * 实测「--看」报没在跑、起完也报没等到，其实窗口早就开在任务栏了。
 * 中文标题走环境变量传（不拼进 -Command，免得被代码页吃掉）。
 */
function 找窗口(标题) {
  if (!标题) return [];
  const ps1 = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    'Add-Type @\'\nusing System;using System.Text;using System.Runtime.InteropServices;\npublic class WTW {\n [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);\n [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);\n [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);\n public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);\n public static System.Collections.Generic.List<string> All(){\n  var r=new System.Collections.Generic.List<string>();\n  EnumWindows((h,l)=>{ if(IsWindowVisible(h)){ var sb=new StringBuilder(300); GetWindowText(h,sb,300); if(sb.Length>0) r.Add(sb.ToString()); } return true; },IntPtr.Zero);\n  return r; }\n}\n\'@',
    '$t=$env:WT_TITLE',
    'if(-not $t){ exit 0 }',
    '[WTW]::All() | Where-Object { $_ -like "*$t*" } | ForEach-Object { $_ }',
  ].join("\n");
  const 临时 = path.join(os.tmpdir(), `起TUI-找窗口-${process.pid}.ps1`);
  try {
    fs.writeFileSync(临时, "\uFEFF" + ps1, "utf8");
    const ps = 跑("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", 临时], {
      env: { ...process.env, WT_TITLE: 标题 },
    });
    return (ps.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
  } finally {
    try { fs.unlinkSync(临时); } catch {}
  }
}

/** 在不在跑：命令行特征命中 或 窗口标题命中，两条都算（任一命中即视为在跑，防重复开） */
function 查活(e) {
  const 进程 = 找进程(e.认进程);
  const 窗口 = 找窗口(e.窗口标题);
  const 活 = 进程.length > 0 || 窗口.length > 0;
  const 说明 = 进程.length
    ? `pid=${进程.map((x) => x.pid).join(",")}`
    : 窗口.length
      ? `窗口「${e.窗口标题}」在`
      : "";
  return { 活, 说明, 进程, 窗口 };
}

function 找条目(词) {
  const 全部 = 配置.条目;
  if (!词) return null;
  return 全部.find((e) => (e.叫法 || []).some((a) => a === 词)) || 全部.find((e) => (e.叫法 || []).some((a) => 词.includes(a) || a.includes(词))) || null;
}

function 打印表() {
  console.log("可以起的窗口（配置在 工具/起TUI.json）：");
  for (const e of 配置.条目) {
    const 查 = 查活(e);
    const 状态 = 查.活 ? `在跑 ${查.说明}` : "没在跑";
    console.log(`  · ${e.叫法[0]}　${状态}　标题「${e.窗口标题}」　启动脚本 ${e.启动.文件}`);
  }
}

/**
 * 起：通过 WMI Win32_Process.Create 脱离父进程 Job Object 拉起，
 * 避免调用方命令行（如 AGY run_command / 子进程）退出时被 Windows 连带杀掉整棵窗口树。
 * 中文路径一律走环境变量 + 带 BOM 的临时 .ps1，不往 -Command 拼引号。
 */
function 起(e) {
  const 目录 = e.工作目录;
  const 命令行 = e.启动.方式 === "bat"
    ? `cmd.exe /c "${e.启动.文件}"`
    : `"${process.execPath}" "${e.启动.文件}"`;
  const ps1 = [
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
    "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:TUI_CMD; CurrentDirectory = $env:TUI_CWD }",
    'Write-Output ("WMI_RC=" + $r.ReturnValue + " PID=" + $r.ProcessId)',
    "if ($r.ReturnValue -ne 0) { exit 1 }",
  ].join("\n");
  const 临时 = path.join(os.tmpdir(), `起TUI-拉起-${process.pid}.ps1`);
  try {
    fs.writeFileSync(临时, "\uFEFF" + ps1, "utf8");
    const r = 跑("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", 临时], {
      env: { ...process.env, TUI_CMD: 命令行, TUI_CWD: 目录 },
    });
    return { 码: r.status, 输出: ((r.stdout || "") + (r.stderr || "")).trim() };
  } finally {
    try { fs.unlinkSync(临时); } catch {}
  }
}

function 主() {
  const 参数 = process.argv.slice(2);
  if (!参数.length || 参数.includes("--看") || 参数.includes("-l")) {
    打印表();
    return 0;
  }
  const 词 = 参数.find((a) => !a.startsWith("-"));
  const 条目 = 找条目(词);
  if (!条目) {
    console.error(`没认出来「${词}」，先看 --看 里有哪些叫法。`);
    return 1;
  }
  const 已活 = 查活(条目);
  if (已活.活 && !参数.includes("--强制")) {
    console.log(`已经在跑，不动它：${条目.叫法[0]} ${已活.说明}　标题「${条目.窗口标题}」`);
    console.log("（要看就在那个窗/标签里看；不要杀、不要重起——重起不会更清楚，只会多一扇。）");
    return 0;
  }
  // ── 开窗闸：新开一扇 TUI 也算开窗，要过闸（2026-11-26 13:2x 他令：没允许只跑子代理）──
  // 自己干活的活丢弃；这扇是他点名要看的常驻界面（5号/发票），在 开窗闸.json 的免口令名单里。
  const 闸 = 跑(process.execPath, [path.join(__dirname, "开窗闸.cjs"), "--用", "--用途", `${条目.叫法[0]} TUI`]);
  const 闸出 = `${闸.stdout || ""}${闸.stderr || ""}`.trim();
  if (闸.status !== 0) {
    console.error(闸出);
    console.error("✗ 没起窗。要起就让他给口令，或者这事改走子代理（无窗口）。");
    return 1;
  }
  console.log(闸出.split("\n")[0] || "已过闸");
  console.log(`起：${条目.叫法[0]}　脚本 ${条目.启动.文件}`);
  const 结果 = 起(条目);
  if (结果.输出) console.log("启动脚本原样输出：\n" + 结果.输出.split("\n").slice(-6).join("\n"));
  // 自证：等最多 20 秒，看进程真出现
  for (let i = 0; i < 10; i++) {
    跑("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 2000"]);
    const 查 = 查活(条目);
    if (查.活) {
      console.log(`起好了：${查.说明}　标题「${条目.窗口标题}」`);
      return 0;
    }
  }
  console.error("没等到进程出现——启动脚本可能报错了。把上面原样输出贴给对应负责人，不要自己手拼 wt 参数。");
  return 1;
}

process.exit(主());
