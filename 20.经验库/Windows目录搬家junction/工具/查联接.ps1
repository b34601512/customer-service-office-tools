# 查联接 —— 列出目录下的 junction / 符号链接，并显示各自指向哪
# 用法: powershell -ExecutionPolicy Bypass -File .\查联接.ps1 "D:\某个目录"
param([string]$Path = ".")
& chcp.com 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

$items = Get-ChildItem -LiteralPath $Path -Force -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }
if (-not $items) { "没有发现 junction / 符号链接：$Path"; exit 0 }
foreach ($i in $items) {
  $t = ""
  try { $t = (Get-Item -LiteralPath $i.FullName -Force).Target } catch {}
  if (-not $t) {
    $raw = (fsutil reparsepoint query "$($i.FullName)" 2>$null | Select-String "Print Name:").ToString()
    $t = ($raw -replace ".*Print Name:\s*", "").Trim()
  }
  "{0}`n    -> {1}" -f $i.FullName, ($t -join ", ")
}
exit 0
