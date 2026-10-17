#Requires -Version 5.1
<#
    脚本编码体检 / 自动修复 —— 全公司统一标准（Windows 脚本）
    用法：
        powershell -NoProfile -ExecutionPolicy Bypass -File 检查脚本编码.ps1 <文件或目录> [...]
        powershell -NoProfile -ExecutionPolicy Bypass -File 检查脚本编码.ps1 -Fix <文件或目录> [...]
        powershell -NoProfile -ExecutionPolicy Bypass -File 检查脚本编码.ps1 -Fix -Recurse "D:\某个项目"

    标准（2026-10-17 老板令，实测台账见本包 README）：
        .bat/.cmd : 纯 ASCII、无 BOM、CRLF      （中文一律下沉到 .ps1，文件名可以中文）
        .ps1      : UTF-8 with BOM、CRLF
        .vbs      : UTF-16LE with BOM、CRLF      （UTF-8 带 BOM 会报「无效字符」；不带 BOM 带中文会报「未结束的字符串常量」）
        .js/.mjs/.cjs : UTF-8、不要 BOM（Node 自己处理，不强制换行）

    修复能力（-Fix）：
        .ps1  ：补 BOM、LF→CRLF
        .vbs  ：转 UTF-16LE+BOM、LF→CRLF（真能修好）
        .bat/.cmd：去 BOM、LF→CRLF；**含中文的仍旧判不合格**（中文必须人工搬到 ps1，不能机器猜）
        改前自动备份同名 .bak-<时间戳>

    安全底线：**改前先确认能正确解码**（UTF-8 / UTF-8 BOM / UTF-16LE / GBK 逐级试）；
    解不出来的文件一律不动、只报「需人工」，绝不把原内容写成问号。GBK 编码的脚本也只报不改。

    退出码：0 全部合格 / 1 有不合格 / 2 参数错误
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Path,
    [switch]$Fix,
    [switch]$Recurse
)

& chcp.com 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

if (-not $Path -or $Path.Count -eq 0) {
    Write-Host '[用法] 检查脚本编码.ps1 [-Fix] [-Recurse] <文件或目录> [...]' -ForegroundColor Yellow
    Write-Host '       例：... -File 检查脚本编码.ps1 -Fix "D:\我的项目"' -ForegroundColor DarkGray
    exit 2
}

$目标扩展 = @('.bat', '.cmd', '.ps1', '.vbs', '.js', '.mjs', '.cjs')
$文件表 = New-Object System.Collections.ArrayList

foreach ($p in $Path) {
    if (-not (Test-Path -LiteralPath $p)) {
        Write-Host ("[跳过] 找不到：{0}" -f $p) -ForegroundColor Yellow
        continue
    }
    $item = Get-Item -LiteralPath $p
    if ($item.PSIsContainer) {
        $扫 = @{ LiteralPath = $item.FullName; File = $true }
        if ($Recurse) { $扫.Recurse = $true }
        Get-ChildItem @扫 | Where-Object {
            $目标扩展 -contains $_.Extension.ToLowerInvariant() -and
            $_.FullName -notmatch '\\(node_modules|\.venv|\.git)\\' -and
            $_.Name -notmatch '\.bak-\d{8}-\d{6}$'
        } | ForEach-Object { [void]$文件表.Add($_.FullName) }
    }
    else {
        [void]$文件表.Add($item.FullName)
    }
}

if ($文件表.Count -eq 0) {
    Write-Host '[结论] 没找到要检查的脚本' -ForegroundColor Yellow
    exit 0
}

$失败数 = 0
$修复数 = 0
$时间戳 = Get-Date -Format 'yyyyMMdd-HHmmss'

function 写备份([string]$路径) {
    Copy-Item -LiteralPath $路径 -Destination ("{0}.bak-{1}" -f $路径, $时间戳) -Force
}

# 换行统一成 CRLF（只动行尾，不碰内容）
function 规整文本([string]$文) {
    $文 = $文 -replace "`r`n", "`n"
    $文 = $文 -replace "`r", "`n"
    return ($文 -replace "`n", "`r`n")
}

# 严格 UTF-8 解码：解不出（有非法字节）返回 $null
function 试解UTF8([byte[]]$b, [int]$起) {
    try {
        $严 = New-Object System.Text.UTF8Encoding($false, $true)
        return , @{ 文 = $严.GetString($b, $起, $b.Length - $起); 码 = 'UTF-8' }
    }
    catch { return $null }
}

$GBK = [Text.Encoding]::GetEncoding(936)

foreach ($p in $文件表) {
    $b = [IO.File]::ReadAllBytes($p)
    $ext = [IO.Path]::GetExtension($p).ToLowerInvariant()

    $有Bom8 = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
    $有Bom16 = ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE)
    $有Bom16BE = ($b.Length -ge 2 -and $b[0] -eq 0xFE -and $b[1] -eq 0xFF)

    # UTF-16LE「无 BOM」也常见：单字节脚本里奇数位几乎全是 0x00
    $疑是16无Bom = $false
    if (-not $有Bom16 -and -not $有Bom16BE -and -not $有Bom8 -and $b.Length -ge 8) {
        $偶数零 = 0; $奇数零 = 0; $对 = [int][Math]::Floor($b.Length / 2)
        for ($i = 0; $i -lt $对; $i++) {
            if ($b[$i * 2] -eq 0) { $偶数零++ }
            if ($b[$i * 2 + 1] -eq 0) { $奇数零++ }
        }
        if ($奇数零 -gt ($对 * 0.8) -and $奇数零 -gt ($偶数零 * 4)) { $疑是16无Bom = $true }
    }

    # —— 判定编码 + 拿到解码后的正文（拿不到就只报不改）——
    $码 = $null
    $文 = $null
    $起 = 0
    if ($有Bom16) { $码 = 'UTF-16LE'; $起 = 2; $文 = [Text.Encoding]::Unicode.GetString($b, $起, $b.Length - $起) }
    elseif ($疑是16无Bom) { $码 = 'UTF-16LE(无BOM)'; $文 = [Text.Encoding]::Unicode.GetString($b, 0, $b.Length - ([int]($b.Length % 2))) }
    elseif ($有Bom16BE) { $码 = 'UTF-16BE'; $起 = 2; $文 = [Text.Encoding]::BigEndianUnicode.GetString($b, $起, $b.Length - $起) }
    else {
        if ($有Bom8) { $起 = 3 }
        $解 = 试解UTF8 $b $起
        if ($解 -ne $null) { $码 = $(if ($有Bom8) { 'UTF-8(BOM)' } else { 'UTF-8' }); $文 = $解.文 }
        else {
            # 非法 UTF-8：多半是本机 ANSI(GBK) 存的旧脚本——只报不改，免得写坏
            $码 = 'GBK/ANSI'
            $文 = $GBK.GetString($b, $起, $b.Length - $起)
        }
    }

    $非ASCII = 0
    if ($码 -ne 'UTF-16LE' -and $码 -ne 'UTF-16LE(无BOM)' -and $码 -ne 'UTF-16BE') {
        for ($i = $起; $i -lt $b.Length; $i++) { if ($b[$i] -gt 127) { $非ASCII++ } }
    }
    else { $非ASCII = -1 }  # UTF-16 不按字节数算

    $CRLF = ([regex]::Matches($文, "`r`n")).Count
    $LF数 = ([regex]::Matches($文, "`n")).Count
    $纯LF = ($LF数 -gt 0 -and $CRLF -eq 0)
    $孤立换行 = $LF数 - $CRLF
    $是能改的编码 = ($码 -ne 'GBK/ANSI' -and $码 -ne 'UTF-16BE')

    Write-Host ("—— {0}" -f $p) -ForegroundColor White
    if ($非ASCII -lt 0) { Write-Host ("   编码：{0}｜CRLF：{1} 处" -f $码, $CRLF) -ForegroundColor DarkGray }
    else { Write-Host ("   编码：{0}｜BOM：{1}｜非 ASCII 字节：{2} 个｜CRLF：{3} 处｜孤立换行：{4} 处" -f $码, $(if ($有Bom8) { '有' } else { '无' }), $非ASCII, $CRLF, $孤立换行) -ForegroundColor DarkGray }

    $病害 = New-Object System.Collections.ArrayList
    $提醒 = New-Object System.Collections.ArrayList
    $能机器修 = $false

    switch ($ext) {
        { $_ -eq '.bat' -or $_ -eq '.cmd' } {
            if ($码 -eq 'UTF-16LE' -or $码 -eq 'UTF-16LE(无BOM)' -or $码 -eq 'UTF-16BE') {
                [void]$病害.Add('bat 存成了 UTF-16——cmd 会整个读错，改存纯 ASCII/UTF-8 无 BOM')
            }
            if ($码 -eq 'GBK/ANSI') { [void]$病害.Add('bat 是 GBK/ANSI 编码——按标准要纯 ASCII（中文下沉 ps1），需人工改') }
            if ($有Bom8) { [void]$病害.Add('bat 带 BOM——cmd 会报「?@echo 不是内部或外部命令」'); if ($是能改的编码) { $能机器修 = $true } }

            # 例外：
            # ① 自包含脚本——bat 头是纯 ASCII，中文都在「#==POWERSHELL==」之后的内嵌 PS 负载里，
            #    且由 [IO.File]::ReadAllText(...,UTF8) 显式解码（18号 CopyPath 就是这个套路）：合格
            # ② bat 头里有 chcp 65001，且中文只出现在 echo 等「命令行参数」里、不在标签/goto/call/变量名里：降级为提醒
            $是自包负载 = $false
            if ($ext -eq '.bat' -or $ext -eq '.cmd') {
                $行表 = $文 -split "`r?`n"
                $标记 = -1
                for ($i = 0; $i -lt $行表.Count; $i++) {
                    if ($行表[$i].Trim() -eq '#==POWERSHELL==') { $标记 = $i; break }
                }
                if ($标记 -gt 0) {
                    $头 = ($行表[0..($标记 - 1)] -join "`n")
                    $头非ASCII = 0
                    foreach ($ch in $头.ToCharArray()) { if ([int]$ch -gt 127) { $头非ASCII++ } }
                    if ($头非ASCII -eq 0 -and $文 -match 'ReadAllText\(.*Encoding\]::UTF8') { $是自包负载 = $true }
                }
            }

            if ($非ASCII -gt 0 -and -not $是自包负载) {
                # 找出「非 ASCII 出现在哪儿」：标签(:名字)、goto/call 目标、变量名（set 变量名 / %变量名%）= 真坏
                 # 中文只在 echo 参数、或 set 的值（set X=中文）里 → 本机能跑，只是不合标准（提醒）
                $坏行 = 0
                foreach ($行 in ($文 -split "`r?`n")) {
                    if ($行 -notmatch '[^\x00-\x7F]') { continue }
                    $干净 = $行.Trim()
                    $像标签 = ($干净 -match '^:[^\s]+')
                    $像跳转 = ($干净 -match '^(goto|call)\s.*[^\x00-\x7F]')
                    $像变量名 = ($干净 -match '^set\s+[^=\s]*[^\x00-\x7F][^=]*=') -or ($干净 -match '%[^%\s]*[^\x00-\x7F][^%\s]*%')
                    if ($像标签 -or $像跳转 -or $像变量名) { $坏行++ }
                }
                if ($坏行 -gt 0) {
                    [void]$病害.Add("bat 里有 $坏行 处中文进了标签/goto/call/set——必坏（实测 goto 中文标签直接报错），中文要人工下沉到 ps1")
                }
                else {
                    [void]$提醒.Add("bat 里有 $非ASCII 个非 ASCII 字节（只在 echo 参数里）——本机能跑，但不合标准：换机器/换代码页就可能乱，建议中文下沉 ps1")
                }
            }
            if ($纯LF) { [void]$病害.Add('换行是纯 LF——cmd 解析会错乱（计划任务还会静默失败）'); if ($是能改的编码) { $能机器修 = $true } }
            if ($孤立换行 -gt 0) { [void]$病害.Add('有孤立换行（CR/LF 不成对）'); if ($是能改的编码) { $能机器修 = $true } }
        }
        '.ps1' {
            if ($码 -eq 'UTF-16LE' -or $码 -eq 'UTF-16LE(无BOM)' -or $码 -eq 'UTF-16BE') {
                [void]$病害.Add('ps1 存成了 UTF-16——建议统一 UTF-8 with BOM'); $能机器修 = $true
            }
            elseif ($码 -eq 'GBK/ANSI') { [void]$病害.Add('ps1 是 GBK/ANSI 编码——PowerShell 5.1 能跑，但按标准要 UTF-8 with BOM，需人工转存') }
            elseif (-not $有Bom8) { [void]$病害.Add('ps1 缺 BOM——PowerShell 5.1 按本地 GBK 读，中文会乱/解析报错'); $能机器修 = $true }
            if ($纯LF) { [void]$病害.Add('换行是 LF——能跑，但按标准统一改 CRLF'); if ($是能改的编码) { $能机器修 = $true } }
            if ($孤立换行 -gt 0) { [void]$病害.Add('有孤立换行'); if ($是能改的编码) { $能机器修 = $true } }
        }
        '.vbs' {
            if ($码 -eq 'UTF-8(BOM)') { [void]$病害.Add('vbs 是 UTF-8 带 BOM——WSH 报「无效字符」编译失败'); $能机器修 = $true }
            elseif ($码 -eq 'UTF-16BE') { [void]$病害.Add('vbs 是 UTF-16BE——WSH 只认 UTF-16LE') }
            elseif ($码 -eq 'UTF-16LE(无BOM)') { [void]$病害.Add('vbs 是 UTF-16LE 但没带 BOM——能跑，按标准补 BOM'); $能机器修 = $true }
            elseif ($码 -eq 'UTF-16LE') { }
            elseif ($码 -eq 'GBK/ANSI') { [void]$病害.Add('vbs 是 GBK/ANSI 编码——能跑但这台机器之外会乱，需人工转存 UTF-16LE') }
            else {
                if ($非ASCII -gt 0) { [void]$病害.Add('vbs 是 UTF-8 无 BOM 且有中文——WSH 报「未结束的字符串常量」'); $能机器修 = $true }
                else { [void]$病害.Add('vbs 没带 UTF-16LE BOM（纯 ASCII 能跑，按标准统一带 BOM）'); $能机器修 = $true }
            }
            if ($纯LF -and $码 -ne 'GBK/ANSI') { [void]$病害.Add('换行是 LF（建议 CRLF）'); $能机器修 = $true }
        }
        default {
            if ($有Bom8) { [void]$病害.Add('JS/JSON 类文件带 BOM——某些解析器会报错'); $能机器修 = $true }
            if ($码 -eq 'GBK/ANSI') { [void]$病害.Add('是 GBK/ANSI 编码——Node 按 UTF-8 读会乱，需人工转存 UTF-8') }
        }
    }

    if ($病害.Count -eq 0) {
        foreach ($t in $提醒) { Write-Host ("   [提醒] " + $t) -ForegroundColor Yellow }
        Write-Host '   [合格]' -ForegroundColor Green
        continue
    }
    foreach ($d in $病害) { Write-Host ("   [不合格] " + $d) -ForegroundColor Red }
    foreach ($t in $提醒) { Write-Host ("   [提醒] " + $t) -ForegroundColor Yellow }

    if (-not $Fix) { $失败数++; continue }

    if (-not $能机器修) {
        Write-Host '   [需人工] 这条不机器改（中文要搬走 / 编码要换存盘方式）' -ForegroundColor Yellow
        $失败数++
        continue
    }

    # —— 动手改（先备份）——
    写备份 $p
    $新文 = 规整文本 $文

    if ($ext -eq '.vbs') {
        $字节 = [byte[]](@(0xFF, 0xFE) + [Text.Encoding]::Unicode.GetBytes($新文))
        [IO.File]::WriteAllBytes($p, $字节)
    }
    elseif ($ext -eq '.ps1') {
        $字节 = [byte[]](@(0xEF, 0xBB, 0xBF) + [Text.Encoding]::UTF8.GetBytes($新文))
        [IO.File]::WriteAllBytes($p, $字节)
    }
    else {
        # bat/cmd 与 js 类：去 BOM、换 CRLF，内容不动
        [IO.File]::WriteAllBytes($p, [Text.Encoding]::UTF8.GetBytes($新文))
    }
    $修复数++
    Write-Host ("   [已修] 编码/换行已按标准重写（原件备份 *.bak-{0}）" -f $时间戳) -ForegroundColor Cyan

    # —— 改完复检（只凭标准，不凭自我感觉）——
    $后 = [IO.File]::ReadAllBytes($p)
    $后Bom8 = ($后.Length -ge 3 -and $后[0] -eq 0xEF -and $后[1] -eq 0xBB -and $后[2] -eq 0xBF)
    $后Bom16 = ($后.Length -ge 2 -and $后[0] -eq 0xFF -and $后[1] -eq 0xFE)
    $后非ASCII = 0
    $后起 = $(if ($后Bom8) { 3 } elseif ($后Bom16) { 2 } else { 0 })
    if (-not $后Bom16) { for ($i = $后起; $i -lt $后.Length; $i++) { if ($后[$i] -gt 127) { $后非ASCII++ } } }
    $后文 = $(if ($后Bom16) { [Text.Encoding]::Unicode.GetString($后, 2, $后.Length - 2) } else { [Text.Encoding]::UTF8.GetString($后, $后起, $后.Length - $后起) })
    $后CRLF = ([regex]::Matches($后文, "`r`n")).Count
    $后LF = ([regex]::Matches($后文, "`n")).Count
    $后纯LF = ($后LF -gt 0 -and $后CRLF -eq 0)

    $还坏 = $false
    if ($ext -eq '.ps1' -and (-not $后Bom8 -or $后纯LF)) { $还坏 = $true }
    if ($ext -eq '.vbs' -and (-not $后Bom16 -or $后纯LF)) { $还坏 = $true }
    if (($ext -eq '.bat' -or $ext -eq '.cmd') -and ($后Bom8 -or $后纯LF)) { $还坏 = $true }

    if ($还坏) {
        Write-Host '   [仍不合格] 还需人工处理（bat 里的中文请搬到 ps1）' -ForegroundColor Red
        $失败数++
    }
    else {
        Write-Host '   [复检] 已合格' -ForegroundColor Green
    }
}

Write-Host ''
if ($失败数 -eq 0) {
    if ($修复数 -gt 0) { Write-Host ("[结论] 全部合格（本次修了 {0} 个文件）" -f $修复数) -ForegroundColor Green }
    else { Write-Host '[结论] 全部合格' -ForegroundColor Green }
    exit 0
}
else {
    Write-Host ("[结论] 有 {0} 个文件不合格（本次修了 {1} 个）——照上面红字改" -f $失败数, $修复数) -ForegroundColor Red
    exit 1
}
