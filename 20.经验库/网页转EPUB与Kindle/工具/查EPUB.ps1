<#
  查EPUB.ps1 —— EPUB 结构与资源「只读体检」
  用于「网页 → EPUB → Kindle」流程第 3 步：转换后先验收，再送去转 AZW3。

  用法：
    powershell -ExecutionPolicy Bypass -File 查EPUB.ps1 <书.epub>

  检查项：
    1. ZIP 里 mimetype 是否存在且内容为 application/epub+zip
    2. META-INF/container.xml 是否可解析、能取到 OPF 路径
    3. OPF（manifest/spine）是否可解析；spine 章节数量
    4. manifest 列的资源是否都在包里（缺图/缺章节会报出）
    5. 空白/极小章节、0 字节资源
    6. 图片清单（png/jpg/jpeg/gif/svg/webp）
  只读：不修改、不解压、不写任何文件。
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Epub
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $Epub -PathType Leaf)) {
  Write-Host "[✖] 找不到文件：$Epub" -ForegroundColor Red
  exit 1
}
$full = (Resolve-Path -LiteralPath $Epub).Path
$issues = New-Object System.Collections.ArrayList

function Get-Entry($zip, [string]$name) {
  $e = $zip.Entries | Where-Object { $_.FullName -eq $name } | Select-Object -First 1
  if ($null -eq $e) {
    $e = $zip.Entries | Where-Object { $_.FullName -ieq $name } | Select-Object -First 1
  }
  return $e
}
function Read-Entry($entry) {
  $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
  $t = $sr.ReadToEnd()
  $sr.Close()
  return $t
}
function Resolve-EntryPath([string]$baseDir, [string]$rel) {
  $rel = [System.Uri]::UnescapeDataString($rel)
  $rel = ($rel -split '#')[0]
  $rel = $rel -replace '/', '\'
  if ($baseDir) { $p = "$baseDir\$rel" } else { $p = $rel }
  $parts = New-Object System.Collections.ArrayList
  foreach ($seg in $p.Split('\')) {
    if ($seg -eq '' -or $seg -eq '.') { continue }
    elseif ($seg -eq '..') { if ($parts.Count -gt 0) { $parts.RemoveAt($parts.Count - 1) } }
    else { [void]$parts.Add($seg) }
  }
  return ($parts -join '/')
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($full)
try {
  $entries = @($zip.Entries)
  Write-Host "== EPUB 体检：$(Split-Path $full -Leaf) =="
  Write-Host ("条目总数：{0}；解压后大小：{1:N0} KB" -f $entries.Count, (($entries | Measure-Object Length -Sum).Sum / 1KB))
  Write-Host ''

  # 1) mimetype
  $mime = Get-Entry $zip 'mimetype'
  if ($null -eq $mime) {
    [void]$issues.Add('缺少 mimetype 文件')
    Write-Host '[✖] mimetype：缺失' -ForegroundColor Red
  } else {
    if ((Read-Entry $mime).Trim() -eq 'application/epub+zip') { Write-Host '[✓] mimetype：正确' -ForegroundColor Green }
    else {
      [void]$issues.Add('mimetype 内容不正确')
      Write-Host '[✖] mimetype：内容不是 application/epub+zip' -ForegroundColor Red
    }
  }

  # 2) container.xml → OPF
  $opfPath = $null
  $container = Get-Entry $zip 'META-INF/container.xml'
  if ($null -eq $container) {
    [void]$issues.Add('缺少 META-INF/container.xml')
    Write-Host '[✖] container.xml：缺失' -ForegroundColor Red
  } else {
    try {
      [xml]$cx = Read-Entry $container
      $rf = @($cx.container.rootfiles.rootfile)
      if ($rf.Count -gt 0 -and $rf[0].'full-path') {
        $opfPath = [string]$rf[0].'full-path'
        Write-Host "[✓] container.xml：可解析，OPF = $opfPath" -ForegroundColor Green
      } else {
        [void]$issues.Add('container.xml 里没有 rootfile full-path')
        Write-Host '[✖] container.xml：找不到 rootfile' -ForegroundColor Red
      }
    } catch {
      [void]$issues.Add('container.xml 解析失败')
      Write-Host '[✖] container.xml：XML 解析失败' -ForegroundColor Red
    }
  }

  # 3) OPF：manifest / spine
  $spineCount = 0
  $manifestItems = @()
  if ($opfPath) {
    $opfEntry = Get-Entry $zip $opfPath
    if ($null -eq $opfEntry) {
      [void]$issues.Add("OPF 文件不存在：$opfPath")
      Write-Host "[✖] OPF：包内找不到 $opfPath" -ForegroundColor Red
    } else {
      try {
        [xml]$opf = Read-Entry $opfEntry
        $manifestItems = @($opf.package.manifest.item)
        $spineRefs = @($opf.package.spine.itemref)
        $spineCount = $spineRefs.Count
        $medias = $manifestItems | Group-Object { $_.'media-type' } | Sort-Object Count -Descending
        Write-Host ("[✓] OPF：可解析；manifest {0} 项，spine {1} 章" -f $manifestItems.Count, $spineCount) -ForegroundColor Green
        Write-Host ('    类型分布：' + (($medias | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join '，'))
      } catch {
        [void]$issues.Add('OPF 解析失败')
        Write-Host '[✖] OPF：XML 解析失败' -ForegroundColor Red
      }
    }
  }

  # 4) manifest 资源齐全性 + 5) 空白检查
  if ($manifestItems.Count -gt 0 -and $opfPath) {
    $opfDir = Split-Path $opfPath -Parent
    $missing = New-Object System.Collections.ArrayList
    $tiny = New-Object System.Collections.ArrayList
    foreach ($it in $manifestItems) {
      $href = [string]$it.href
      if (-not $href) { continue }
      $target = Resolve-EntryPath $opfDir $href
      $en = Get-Entry $zip $target
      if ($null -eq $en) { [void]$missing.Add("$href（$($it.'media-type')）"); continue }
      $mt = [string]$it.'media-type'
      if ($mt -match 'xhtml|html') {
        if ($en.Length -lt 200) { [void]$tiny.Add("$target（$($en.Length) 字节，疑似空白章节）") }
      } elseif ($en.Length -eq 0) {
        [void]$tiny.Add("$target（0 字节）")
      }
    }
    if ($missing.Count -eq 0) { Write-Host '[✓] 资源齐全：manifest 列的文件都在包里' -ForegroundColor Green }
    else {
      foreach ($m in $missing) { [void]$issues.Add("缺资源：$m") }
      Write-Host ("[✖] 缺资源 {0} 项：" -f $missing.Count) -ForegroundColor Red
      $missing | ForEach-Object { Write-Host "    - $_" }
    }
    if ($tiny.Count -gt 0) {
      Write-Host ("[!] 疑似空白/极小文件 {0} 个：" -f $tiny.Count) -ForegroundColor Yellow
      $tiny | ForEach-Object { Write-Host "    - $_" }
    } else { Write-Host '[✓] 空白检查：没有极小章节/0 字节资源' -ForegroundColor Green }
  }

  # 6) 图片清单
  $imgs = $entries | Where-Object { $_.FullName -match '\.(png|jpe?g|gif|svg|webp)$' }
  Write-Host ''
  if ($imgs.Count -gt 0) {
    Write-Host ("图片 {0} 张：" -f $imgs.Count)
    $imgs | Sort-Object FullName | ForEach-Object {
      $sz = if ($_.Length -lt 1024) { "$($_.Length) 字节" } else { "{0:N1} KB" -f ($_.Length / 1KB) }
      Write-Host ("    {0}  ({1})" -f $_.FullName, $sz)
    }
    $zero = @($imgs | Where-Object { $_.Length -eq 0 })
    if ($zero.Count -gt 0) {
      foreach ($z in $zero) { [void]$issues.Add("0 字节图片：$($z.FullName)") }
      Write-Host ("[✖] 其中 {0} 张为 0 字节" -f $zero.Count) -ForegroundColor Red
    }
  } else { Write-Host '[!] 没找到图片（如果这本书本该有图，回来查）' -ForegroundColor Yellow }

  # 总结
  Write-Host ''
  if ($issues.Count -eq 0) {
    Write-Host '== 结论：结构体检通过（未发现阻断性问题）==' -ForegroundColor Green
    exit 0
  } else {
    Write-Host ("== 结论：发现 {0} 个问题 ==" -f $issues.Count) -ForegroundColor Red
    $issues | ForEach-Object { Write-Host "  - $_" }
    exit 1
  }
} finally {
  $zip.Dispose()
}
