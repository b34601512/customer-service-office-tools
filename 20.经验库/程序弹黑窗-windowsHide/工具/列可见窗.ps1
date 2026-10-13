# List all VISIBLE top-level windows (handle / class / title). ASCII-only (PS 5.1 safe).
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File 工具\列可见窗.ps1
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinList {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);
}
"@
$rows = New-Object System.Collections.ArrayList
$cb = [WinList+EnumProc]{
  param($h, $l)
  if ([WinList]::IsWindowVisible($h)) {
    $t = New-Object System.Text.StringBuilder 256; [void][WinList]::GetWindowTextW($h, $t, 256)
    $c = New-Object System.Text.StringBuilder 256; [void][WinList]::GetClassNameW($h, $c, 256)
    [void]$rows.Add([pscustomobject]@{ Handle = $h; Class = $c.ToString(); Title = $t.ToString() })
  }
  return $true
}
[void][WinList]::EnumWindows($cb, [IntPtr]::Zero)
$rows | Format-Table -AutoSize
Write-Host ("Total visible top-level windows: " + $rows.Count)
