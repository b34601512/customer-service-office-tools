#Requires -Version 5.1
<#
    编码体检 —— 检查 Windows 启动器（.bat / .ps1）是否符合「中文乱码修复」规范
    用法：
        powershell -NoProfile -ExecutionPolicy Bypass -File 检查编码.ps1 "launcher.bat" "launcher.ps1"
    期望：
        .bat/.cmd：无 BOM、无任何非 ASCII 字节、CRLF 换行 → 合格
        .ps1     ：UTF-8 with BOM、换行正常（CRLF） → 合格
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Path)

& chcp.com 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

if (-not $Path -or $Path.Count -eq 0) {
    Write-Host '[用法] 检查编码.ps1 <文件1> [文件2 ...]' -ForegroundColor Yellow
    exit 2
}

$failCount = 0
foreach ($p in $Path) {
    if (-not (Test-Path -LiteralPath $p)) {
        Write-Host ("[跳过] 找不到：{0}" -f $p) -ForegroundColor Yellow
        continue
    }
    $full = (Resolve-Path -LiteralPath $p).Path
    $b = [IO.File]::ReadAllBytes($full)

    $hasBom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)

    $nonAscii = 0
    foreach ($by in $b) { if ($by -gt 127) { $nonAscii++ } }

    $crlf = 0
    $loneCr = 0
    $hasLf = $false
    for ($i = 0; $i -lt $b.Length; $i++) {
        if ($b[$i] -eq 10) { $hasLf = $true }
        if ($b[$i] -eq 13) {
            if ($i + 1 -lt $b.Length -and $b[$i + 1] -eq 10) { $crlf++ }
            else { $loneCr++ }
        }
    }

    $ext = [IO.Path]::GetExtension($p).ToLowerInvariant()
    Write-Host ("—— {0}" -f $p) -ForegroundColor White
    Write-Host ("   BOM：{0}｜非 ASCII 字节：{1} 个｜CRLF 换行：{2} 处｜孤立 CR：{3} 处" -f `
        $(if ($hasBom) { '有' } else { '无' }), $nonAscii, $crlf, $loneCr)

    if ($ext -eq '.bat' -or $ext -eq '.cmd') {
        $bad = $false
        if ($hasBom) { Write-Host '   [不合格] bat 不能带 BOM' -ForegroundColor Red; $bad = $true }
        if ($nonAscii -gt 0) { Write-Host '   [不合格] bat 里有非 ASCII 字节——中文要下沉到 ps1' -ForegroundColor Red; $bad = $true }
        if ($loneCr -gt 0) { Write-Host '   [不合格] 有孤立 CR（换行被打断过）' -ForegroundColor Red; $bad = $true }
        if ($hasLf -and $crlf -eq 0) { Write-Host '   [不合格] 换行是纯 LF——bat 请用 CRLF' -ForegroundColor Red; $bad = $true }
        if (-not $bad) { Write-Host '   [合格] 纯 ASCII、无 BOM、换行正常' -ForegroundColor Green }
        if ($bad) { $failCount++ }
    }
    elseif ($ext -eq '.ps1') {
        $bad = $false
        if (-not $hasBom) { Write-Host '   [不合格] ps1 缺 BOM——PowerShell 5.1 会按本地编码读，中文会乱' -ForegroundColor Red; $bad = $true }
        if ($loneCr -gt 0) { Write-Host '   [不合格] 有孤立 CR（换行被打断过）' -ForegroundColor Red; $bad = $true }
        if (-not $bad) { Write-Host '   [合格] 带 BOM、换行正常' -ForegroundColor Green }
        if ($hasLf -and $crlf -eq 0) { Write-Host '   [注意] 换行是 LF——建议改 CRLF（稳妥）' -ForegroundColor Yellow }
        if ($bad) { $failCount++ }
    }
    else {
        Write-Host '   [跳过] 只检查 .bat / .cmd 与 .ps1' -ForegroundColor Yellow
    }
}

Write-Host ''
if ($failCount -eq 0) {
    Write-Host '[结论] 全部合格' -ForegroundColor Green
    exit 0
}
else {
    Write-Host ("[结论] 有 {0} 处不合格，照上面的红字修。" -f $failCount) -ForegroundColor Red
    exit 1
}
