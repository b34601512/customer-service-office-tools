# single-instance-guard.ps1 -- boot-window double-start guard (ASCII-only on purpose).
# Why: at logon both the Startup shortcut and pi-watchdog's self-heal may launch the window
# within seconds of each other (seen 2026-10-05 and 2026-10-07). If a boot window for THIS
# folder started less than N seconds ago, this launcher invocation lost the race -> skip.
# v2 (2026-10-12, case: 技术·王语嫣): also refuse when ANY live same-folder pi process exists
# (not only <N seconds old). Opening a 2nd window on a LIVE session resumes the same session
# file; session recovery retires+deletes the live window's wake loop -> the first window goes
# deaf (monitor events fire, but no loop wakes it; 收件箱 messages pile up unread). 链体检/看窗
# both see "process alive + listener alive" and stay green. So: one folder = at most one window.
# -ForceOpen keeps the old FreshSeconds-only behavior (escape hatch; do NOT use lightly).
# Exit codes: 0 = skip (a window already exists); 2 = proceed.
# Any error also falls through to 2, so a broken guard can never block the window from starting.
param([int]$FreshSeconds = 120, [switch]$ForceOpen, [string]$家 = '')

# v3 (2026-10-18 23:15, case: 王语嫣 two windows):
# The old check required BOTH '*pi-coding-agent*' AND the boot-prompt.md path on the
# command line. But two kinds of windows do NOT carry that path:
#   (a) a window the boss opens by typing `pi` himself
#   (b) a window opened via PiCodingAgentInstallerin\pi.cmd (the path is not an argument)
# So a live window could exist while this guard said "none" -> a second window opened
# on the same folder (observed 2026-10-18: 22:24 window + 23:13 window on 技术·王语嫣).
# New rule: a pi MAIN process whose command line mentions this folder = a live window.
# Still excludes helper processes (heartbeat / waker / daemon / readers).
$ErrorActionPreference = 'Stop'
try {
    $folder   = $PSScriptRoot                       # ...\<employee>\工具\企微  (or wherever this guard sits)
    # 2026-10-21 add -家: some homes keep their kit outside <home>\工具\企微 (木婉清 27.企业微信机器人),
    # so "up two levels" lands on D:\桌面 instead of the home -> would match every desktop-home window.
    if ($家) { $homeDir = $家 } else {
      # 推家目录之前先确认布局：套件必须是 <家>\工具\企微。
      # 不是（例：木婉清 27.企业微信机器人、或真源那份放在 共享\企微工具 被直接调）→ 推出来会错到上层目录，
      # 反而把别家的窗当成自家的、永远不放行。认不准就 exit 2（放行）——宁可双开也不要把窗堵死。
      if ((Split-Path (Split-Path $folder -Parent) -Leaf) -ne '工具') { exit 2 }
      $homeDir = Split-Path (Split-Path $folder -Parent) -Parent
    }
    $homeDirRe   = [regex]::Escape($homeDir)
    $cutoff   = (Get-Date).AddSeconds(-$FreshSeconds)
    $procs    = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
    foreach ($p in $procs) {
        $cl = $p.CommandLine
        if (-not $cl) { continue }
        if ($cl -notmatch 'pi-coding-agent|pi[.]cmd') { continue }
        if ($cl -match '心跳|叫醒器|守护|跟读收件箱|跟读公告板|告警喇叭') { continue }
        if ($cl -notmatch $homeDirRe) { continue }      # not this employee's folder
        if (-not $ForceOpen) { exit 0 }              # live window for this folder (any age) -> never double-open
        $start = [DateTime]$p.CreationDate
        if ($start -gt $cutoff) { exit 0 }
    }
    exit 2
} catch {
    exit 2
}
