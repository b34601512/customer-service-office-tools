[CmdletBinding()]
param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Section {
  param([string]$Message)

  Write-Host ""
  Write-Host "=== $Message ===" -ForegroundColor Cyan
}

function Write-Utf8File {
  param(
    [string]$FilePath,
    [string]$Content
  )

  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($FilePath, $Content, $utf8WithoutBom)
}

function Read-JsonFile {
  param(
    [string]$FilePath,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "缺少${Label}：$FilePath"
  }

  return Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Normalize-ReleaseVersion {
  param([string]$InputVersion)

  $normalizedVersion = [string]$InputVersion
  $normalizedVersion = $normalizedVersion.Trim()
  if ($normalizedVersion.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
    $normalizedVersion = $normalizedVersion.Substring(1)
  }

  if ($normalizedVersion -notmatch "^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$") {
    throw "版本号格式不正确。请使用 1.2.3 或 1.2.3-beta.1 这样的格式。"
  }

  return $normalizedVersion
}

function Resolve-ReleaseVersion {
  param(
    [string]$RequestedVersion,
    [string]$CurrentVersion
  )

  Write-Host "当前项目版本：v$CurrentVersion" -ForegroundColor Yellow
  if ([string]::IsNullOrWhiteSpace($RequestedVersion)) {
    $versionInput = Read-Host "请输入本次打包版本号（直接回车沿用当前版本）"
  } else {
    $versionInput = $RequestedVersion
  }

  if ([string]::IsNullOrWhiteSpace($versionInput)) {
    return Normalize-ReleaseVersion -InputVersion $CurrentVersion
  }

  return Normalize-ReleaseVersion -InputVersion $versionInput
}

function Resolve-NodeExecutable {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand -or -not (Test-Path -LiteralPath $nodeCommand.Source -PathType Leaf)) {
    throw "当前电脑未找到 node.exe，无法制作自带运行环境的便携包。"
  }

  return [System.IO.Path]::GetFullPath($nodeCommand.Source)
}

function Assert-PackageSources {
  param(
    [string]$ProjectRoot,
    [string]$NodeExecutable
  )

  $requiredPaths = @(
    (Join-Path $ProjectRoot "src\cli\startCli.js"),
    (Join-Path $ProjectRoot "node_modules\playwright-core\package.json"),
    (Join-Path $ProjectRoot "node_modules\xlsx\package.json"),
    (Join-Path $ProjectRoot "node_modules\jszip\package.json"),
    (Join-Path $ProjectRoot "node_modules\@xmldom\xmldom\package.json"),
    $NodeExecutable
  )

  foreach ($requiredPath in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw "打包依赖不完整：$requiredPath"
    }
  }
}

function ConvertTo-ZipEntryPath {
  param([string]$PathText)

  return ([string]$PathText).Replace("\", "/")
}

function Add-FileToZip {
  param(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$SourceFilePath,
    [string]$EntryPath
  )

  $normalizedEntryPath = ConvertTo-ZipEntryPath -PathText $EntryPath
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $Archive,
    $SourceFilePath,
    $normalizedEntryPath,
    [System.IO.Compression.CompressionLevel]::Optimal
  ) | Out-Null
}

function Add-TextToZip {
  param(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$EntryPath,
    [string]$Content,
    [bool]$UseUtf8Bom = $false
  )

  $normalizedEntryPath = ConvertTo-ZipEntryPath -PathText $EntryPath
  $entry = $Archive.CreateEntry($normalizedEntryPath, [System.IO.Compression.CompressionLevel]::Optimal)
  $entryStream = $entry.Open()
  $textEncoding = New-Object System.Text.UTF8Encoding($UseUtf8Bom)
  $writer = New-Object System.IO.StreamWriter($entryStream, $textEncoding)
  try {
    $writer.Write($Content)
  } finally {
    $writer.Dispose()
    $entryStream.Dispose()
  }
}

function Add-DirectoryToZip {
  param(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$SourceDirectory,
    [string]$PackageRootName,
    [string]$TargetDirectory
  )

  $sourceDirectoryFullPath = [System.IO.Path]::GetFullPath($SourceDirectory)
  $sourcePrefixLength = $sourceDirectoryFullPath.TrimEnd("\").Length + 1
  $sourceFiles = Get-ChildItem -LiteralPath $sourceDirectoryFullPath -File -Recurse

  foreach ($sourceFile in $sourceFiles) {
    $relativePath = $sourceFile.FullName.Substring($sourcePrefixLength)
    $entryPath = Join-Path $PackageRootName (Join-Path $TargetDirectory $relativePath)
    Add-FileToZip -Archive $Archive -SourceFilePath $sourceFile.FullName -EntryPath $entryPath
  }
}

function New-PortableStartScript {
  return @'
@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\startPortableApp.ps1"
set "appExitCode=%ERRORLEVEL%"
endlocal & exit /b %appExitCode%
'@
}

function New-PortablePowerShellLauncher {
  param([string]$ReleaseVersion)

  return @"
`$ErrorActionPreference = "Stop"
`$host.UI.RawUI.WindowTitle = "客服数据自动更新 v$ReleaseVersion"
`$projectRoot = [System.IO.Path]::GetFullPath((Join-Path `$PSScriptRoot ".."))
`$nodeExecutable = Join-Path `$projectRoot "程序运行环境\node.exe"
`$applicationEntry = Join-Path `$projectRoot "src\cli\startCli.js"

try {
  Write-Host ""
  Write-Host "客服数据自动更新 v$ReleaseVersion" -ForegroundColor Cyan
  Write-Host "正在启动，请勿关闭此窗口……"

  if (-not (Test-Path -LiteralPath `$nodeExecutable -PathType Leaf)) {
    throw "压缩包不完整，缺少程序运行环境。"
  }
  if (-not (Test-Path -LiteralPath `$applicationEntry -PathType Leaf)) {
    throw "压缩包不完整，缺少程序入口。"
  }

  & `$nodeExecutable `$applicationEntry
  `$applicationExitCode = `$LASTEXITCODE
  if (`$applicationExitCode -ne 0) {
    throw "程序异常退出，错误码：`$applicationExitCode"
  }
  exit 0
} catch {
  Write-Host ""
  Write-Host "启动失败：`$(`$_.Exception.Message)" -ForegroundColor Red
  Read-Host "按回车键关闭窗口"
  exit 1
}
"@
}

function New-EndUserGuide {
  param(
    [string]$ReleaseVersion,
    [string]$NodeVersion
  )

  return @"
客服数据自动更新 v$ReleaseVersion

【使用方法】
1. 先把整个压缩包解压到本地文件夹，不要在压缩包内直接运行。
2. 双击“启动客服数据自动更新.bat”。
3. 首次使用时，在CLI菜单中填写自己的汇总表路径、店铺和账号信息。
4. 按CLI提示登录天猫、京东、拼多多或抖音后台。

【电脑要求】
- Windows 10 或 Windows 11（64 位）
- 已安装 Google Chrome 或 Microsoft Edge
- 可以正常访问相关电商后台
- 不需要安装 Node.js、npm 或开发工具

【安全说明】
- 便携包不包含打包电脑上的账号、密码、登录状态、运行日志和下载数据。
- 每位使用者的配置和登录状态只保存在自己的解压目录中。
- 不要把填写过账号密码的使用目录再次转发给其他人。

【版本信息】
- 应用版本：v$ReleaseVersion
- 内置 Node：$NodeVersion
"@
}

function New-ReleaseMetadata {
  param(
    [string]$ReleaseVersion,
    [string]$NodeVersion
  )

  $metadata = [ordered]@{
    applicationName = "客服数据自动更新"
    version = $ReleaseVersion
    builtAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
    nodeVersion = $NodeVersion
    configurationPolicy = "clean-first-run"
  }
  return ($metadata | ConvertTo-Json -Depth 5) + [Environment]::NewLine
}

function Get-VersionedPackageJsonText {
  param(
    [object]$PackageManifest,
    [string]$ReleaseVersion
  )

  $PackageManifest.version = $ReleaseVersion
  return ($PackageManifest | ConvertTo-Json -Depth 100) + [Environment]::NewLine
}

function Get-VersionedPackageLockText {
  param(
    [string]$PackageLockText,
    [string]$ReleaseVersion
  )

  $versionPattern = New-Object System.Text.RegularExpressions.Regex(
    '"version"\s*:\s*"[^"]*"',
    [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
  )
  $versionMatches = $versionPattern.Matches($PackageLockText)
  if ($versionMatches.Count -lt 2) {
    throw "package-lock.json 结构异常，未找到项目版本字段。"
  }

  $updatedText = $PackageLockText
  for ($matchIndex = 1; $matchIndex -ge 0; $matchIndex--) {
    $versionMatch = $versionMatches[$matchIndex]
    $replacementText = '"version": "' + $ReleaseVersion + '"'
    $updatedText =
      $updatedText.Substring(0, $versionMatch.Index) +
      $replacementText +
      $updatedText.Substring($versionMatch.Index + $versionMatch.Length)
  }

  return $updatedText
}

function Get-UniqueBackupFilePath {
  param(
    [string]$BackupDirectory,
    [string]$OriginalFileName
  )

  $fileNameWithoutExtension = [System.IO.Path]::GetFileNameWithoutExtension($OriginalFileName)
  $fileExtension = [System.IO.Path]::GetExtension($OriginalFileName)
  $timeTag = Get-Date -Format "yyyyMMdd-HHmmss"
  $candidatePath = Join-Path $BackupDirectory "${fileNameWithoutExtension}-${timeTag}${fileExtension}"
  if (-not (Test-Path -LiteralPath $candidatePath)) {
    return $candidatePath
  }

  $uniqueTag = [Guid]::NewGuid().ToString("N").Substring(0, 8)
  return Join-Path $BackupDirectory "${fileNameWithoutExtension}-${timeTag}-${uniqueTag}${fileExtension}"
}

function Move-ArchiveToBackup {
  param(
    [string]$ArchivePath,
    [string]$BackupRootDirectory,
    [string]$BackupCategory
  )

  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    return ""
  }

  $backupDirectory = Join-Path $BackupRootDirectory (Join-Path "客服数据自动更新\发布包" $BackupCategory)
  [System.IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
  $backupPath = Get-UniqueBackupFilePath -BackupDirectory $backupDirectory -OriginalFileName ([System.IO.Path]::GetFileName($ArchivePath))
  Move-Item -LiteralPath $ArchivePath -Destination $backupPath
  return $backupPath
}

function New-PortableArchive {
  param(
    [string]$ProjectRoot,
    [string]$ArchivePath,
    [string]$PackageRootName,
    [string]$NodeExecutable,
    [string]$PackageJsonText,
    [string]$PackageLockText,
    [string]$ReleaseVersion,
    [string]$NodeVersion
  )

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $archiveFileStream = [System.IO.File]::Open(
    $ArchivePath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
  $archive = New-Object System.IO.Compression.ZipArchive(
    $archiveFileStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )

  try {
    Add-DirectoryToZip -Archive $archive -SourceDirectory (Join-Path $ProjectRoot "src") -PackageRootName $PackageRootName -TargetDirectory "src"
    Add-DirectoryToZip -Archive $archive -SourceDirectory (Join-Path $ProjectRoot "node_modules") -PackageRootName $PackageRootName -TargetDirectory "node_modules"
    Add-FileToZip -Archive $archive -SourceFilePath $NodeExecutable -EntryPath (Join-Path $PackageRootName "程序运行环境\node.exe")

    $exampleConfigPath = Join-Path $ProjectRoot "project-config\jd-open-api.local.example.json"
    if (Test-Path -LiteralPath $exampleConfigPath -PathType Leaf) {
      Add-FileToZip -Archive $archive -SourceFilePath $exampleConfigPath -EntryPath (Join-Path $PackageRootName "project-config\jd-open-api.local.example.json")
    }

    Add-TextToZip -Archive $archive -EntryPath (Join-Path $PackageRootName "package.json") -Content $PackageJsonText
    Add-TextToZip -Archive $archive -EntryPath (Join-Path $PackageRootName "package-lock.json") -Content $PackageLockText
    $portableStartScript = (New-PortableStartScript) -replace "`r?`n", "`r`n"
    $portablePowerShellLauncher = (New-PortablePowerShellLauncher -ReleaseVersion $ReleaseVersion) -replace "`r?`n", "`r`n"
    Add-TextToZip -Archive $archive -EntryPath (Join-Path $PackageRootName "启动客服数据自动更新.bat") -Content $portableStartScript
    Add-TextToZip -Archive $archive -EntryPath (Join-Path $PackageRootName "scripts\startPortableApp.ps1") -Content $portablePowerShellLauncher -UseUtf8Bom $true
    Add-TextToZip -Archive $archive -EntryPath (Join-Path $PackageRootName "使用说明.txt") -Content (New-EndUserGuide -ReleaseVersion $ReleaseVersion -NodeVersion $NodeVersion)
    Add-TextToZip -Archive $archive -EntryPath (Join-Path $PackageRootName "版本信息.json") -Content (New-ReleaseMetadata -ReleaseVersion $ReleaseVersion -NodeVersion $NodeVersion)
  } finally {
    $archive.Dispose()
    $archiveFileStream.Dispose()
  }
}

function Test-PortableArchive {
  param(
    [string]$ArchivePath,
    [string]$PackageRootName
  )

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
    $requiredEntryNames = @(
      "$PackageRootName/程序运行环境/node.exe",
      "$PackageRootName/src/cli/startCli.js",
      "$PackageRootName/node_modules/playwright-core/package.json",
      "$PackageRootName/node_modules/xlsx/package.json",
      "$PackageRootName/node_modules/jszip/package.json",
      "$PackageRootName/node_modules/@xmldom/xmldom/package.json",
      "$PackageRootName/启动客服数据自动更新.bat",
      "$PackageRootName/scripts/startPortableApp.ps1",
      "$PackageRootName/使用说明.txt",
      "$PackageRootName/版本信息.json"
    )

    foreach ($requiredEntryName in $requiredEntryNames) {
      if ($entryNames -notcontains $requiredEntryName) {
        throw "便携包校验失败，缺少：$requiredEntryName"
      }
    }

    $forbiddenEntryPatterns = @(
      "$PackageRootName/runtime/",
      "$PackageRootName/outputs/",
      "$PackageRootName/project-config/platform-config.json",
      "$PackageRootName/.git/"
    )
    foreach ($forbiddenEntryPattern in $forbiddenEntryPatterns) {
      if ($entryNames | Where-Object { $_.StartsWith($forbiddenEntryPattern, [System.StringComparison]::OrdinalIgnoreCase) }) {
        throw "便携包校验失败，包含禁止外发内容：$forbiddenEntryPattern"
      }
    }

    $nodeEntry = $archive.GetEntry("$PackageRootName/程序运行环境/node.exe")
    if ($null -eq $nodeEntry -or $nodeEntry.Length -lt 10MB) {
      throw "便携包校验失败，内置 node.exe 不完整。"
    }

    return $archive.Entries.Count
  } finally {
    $archive.Dispose()
  }
}

function Update-ProjectVersionFiles {
  param(
    [string]$PackageJsonPath,
    [string]$PackageLockPath,
    [string]$PackageJsonText,
    [string]$PackageLockText
  )

  Write-Utf8File -FilePath $PackageJsonPath -Content $PackageJsonText
  Write-Utf8File -FilePath $PackageLockPath -Content $PackageLockText
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageJsonPath = Join-Path $projectRoot "package.json"
$packageLockPath = Join-Path $projectRoot "package-lock.json"
$releaseDirectory = Join-Path $projectRoot "发布包"
$projectDriveRoot = [System.IO.Path]::GetPathRoot($projectRoot)
$backupRootDirectory = Join-Path $projectDriveRoot "备份文件夹"
$archivePath = ""

try {
  Write-Section -Message "便携版打包"
  $packageManifest = Read-JsonFile -FilePath $packageJsonPath -Label "package.json"
  if (-not (Test-Path -LiteralPath $packageLockPath -PathType Leaf)) {
    throw "缺少 package-lock.json：$packageLockPath"
  }
  $sourcePackageLockText = Get-Content -LiteralPath $packageLockPath -Raw -Encoding UTF8
  $releaseVersion = Resolve-ReleaseVersion -RequestedVersion $Version -CurrentVersion ([string]$packageManifest.version)
  $packageRootName = "客服数据自动更新-v$releaseVersion"
  $archiveFileName = "$packageRootName.zip"
  $archivePath = Join-Path $releaseDirectory $archiveFileName

  Write-Section -Message "检查打包环境"
  $nodeExecutable = Resolve-NodeExecutable
  $nodeVersion = [string](& $nodeExecutable --version)
  Assert-PackageSources -ProjectRoot $projectRoot -NodeExecutable $nodeExecutable
  Write-Host "应用版本：v$releaseVersion"
  Write-Host "内置 Node：$nodeVersion"

  [System.IO.Directory]::CreateDirectory($releaseDirectory) | Out-Null
  $previousArchiveBackupPath = Move-ArchiveToBackup -ArchivePath $archivePath -BackupRootDirectory $backupRootDirectory -BackupCategory "历史版本"
  if (-not [string]::IsNullOrWhiteSpace($previousArchiveBackupPath)) {
    Write-Host "同名旧包已移到备份：$previousArchiveBackupPath"
  }

  $packageJsonText = Get-VersionedPackageJsonText -PackageManifest $packageManifest -ReleaseVersion $releaseVersion
  $packageLockText = Get-VersionedPackageLockText -PackageLockText $sourcePackageLockText -ReleaseVersion $releaseVersion

  Write-Section -Message "生成压缩包"
  New-PortableArchive `
    -ProjectRoot $projectRoot `
    -ArchivePath $archivePath `
    -PackageRootName $packageRootName `
    -NodeExecutable $nodeExecutable `
    -PackageJsonText $packageJsonText `
    -PackageLockText $packageLockText `
    -ReleaseVersion $releaseVersion `
    -NodeVersion $nodeVersion

  $entryCount = Test-PortableArchive -ArchivePath $archivePath -PackageRootName $packageRootName
  Update-ProjectVersionFiles `
    -PackageJsonPath $packageJsonPath `
    -PackageLockPath $packageLockPath `
    -PackageJsonText $packageJsonText `
    -PackageLockText $packageLockText

  $archiveSizeMb = [math]::Round((Get-Item -LiteralPath $archivePath).Length / 1MB, 2)
  Write-Section -Message "打包完成"
  Write-Host "版本：v$releaseVersion" -ForegroundColor Green
  Write-Host "文件数：$entryCount"
  Write-Host "压缩包：$archivePath"
  Write-Host "大小：${archiveSizeMb} MB"
  Write-Host ""
  Write-Host "该压缩包不含现有账号密码、登录状态、日志和下载数据。" -ForegroundColor Yellow
  exit 0
} catch {
  if (-not [string]::IsNullOrWhiteSpace($archivePath) -and (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    try {
      $failedArchiveBackupPath = Move-ArchiveToBackup -ArchivePath $archivePath -BackupRootDirectory $backupRootDirectory -BackupCategory "失败包"
      Write-Host "未完成的压缩包已移到备份：$failedArchiveBackupPath" -ForegroundColor DarkYellow
    } catch {
      Write-Host "未完成压缩包无法移动，请勿外发：$archivePath" -ForegroundColor Red
    }
  }

  Write-Host ""
  Write-Host "打包失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
