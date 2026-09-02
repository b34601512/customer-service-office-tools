param(
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$DriveRoot = [System.IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $Root).Path)
$BackupFolderName = -join ([char[]](0x5907, 0x4EFD, 0x6587, 0x4EF6, 0x5939))
$BackupBase = Join-Path (Join-Path $DriveRoot $BackupFolderName) ("douyin_commenter_old_build_outputs_" + $Timestamp)
$BuildRoot = Join-Path $Root ".pyinstaller_build"
$DistRoot = Join-Path $Root "dist"
$ReleaseRoot = Join-Path $Root "release_package"
$AppMetadataPath = Join-Path $Root "douyin_commenter\app_metadata.py"
$PackageDisplayName = "抖音直播评论员"
$ReleaseDir = ""
$ZipPath = ""
$ExeName = "DouyinLiveCommenter.exe"

function Write-ReleaseLog {
    param(
        [string]$Action,
        [string]$SubAction,
        [string]$Message = ""
    )
    $frame = (Get-PSCallStack)[1]
    $lineNumber = if ($frame.ScriptLineNumber) { $frame.ScriptLineNumber } else { "?" }
    $prefix = "[{0}][build_release.ps1:{1}][main:Release:{2}][release.build][{3}]" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $lineNumber, $Action, $SubAction
    if ([string]::IsNullOrWhiteSpace($Message)) {
        Write-Host $prefix
        return
    }
    Write-Host "$prefix $Message"
}

function Move-ToBackupIfExists {
    param([string]$TargetPath)
    if (-not (Test-Path -LiteralPath $TargetPath)) {
        return
    }
    New-Item -ItemType Directory -Path $BackupBase -Force | Out-Null
    $destination = Join-Path $BackupBase (Split-Path -Leaf $TargetPath)
    Write-ReleaseLog "backup" "move-old-output" "from='$TargetPath' to='$destination'"
    Move-Item -LiteralPath $TargetPath -Destination $destination
}

function Get-AppVersion {
    # 这个函数用于从唯一版本源读取版本号，避免发布包文件名和后台显示不一致。
    $content = Get-Content -LiteralPath $AppMetadataPath -Raw -Encoding UTF8
    $match = [regex]::Match($content, 'version\s*=\s*"([^"]+)"')
    if (-not $match.Success) {
        throw "读取版本失败：未在 $AppMetadataPath 找到 version 字段"
    }
    $version = $match.Groups[1].Value.Trim()
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "读取版本失败：version 字段为空"
    }
    if ($version.StartsWith("v")) {
        return $version
    }
    return "v$version"
}

function Get-PythonCommand {
    # This function selects Python on the build machine. The release PC does not need Python.
    $pythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        return "python"
    }
    throw "Build machine has no python command, cannot build exe."
}

function Test-PythonModule {
    param(
        [string]$PythonCommand,
        [string]$ModuleName
    )
    & $PythonCommand -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('$ModuleName') else 1)"
    return $LASTEXITCODE -eq 0
}

function Ensure-PythonModule {
    param(
        [string]$PythonCommand,
        [string]$ModuleName,
        [string]$PackageName
    )
    if (Test-PythonModule -PythonCommand $PythonCommand -ModuleName $ModuleName) {
        Write-ReleaseLog "deps" "module-ok" "module='$ModuleName'"
        return
    }
    Write-ReleaseLog "deps" "install-module" "$PythonCommand -m pip install $PackageName"
    & $PythonCommand -m pip install $PackageName
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install python package: $PackageName"
    }
}

function Copy-ReleaseFiles {
    param([string]$BuiltAppDir)
    New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
    Get-ChildItem -LiteralPath $BuiltAppDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $ReleaseDir -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $Root "config.json") -Destination (Join-Path $ReleaseDir "config.json") -Force
    $hiddenLauncher = @'
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir
command = Chr(34) & scriptDir & "\DouyinLiveCommenter.exe" & Chr(34)
shell.Run command, 0, False
'@
    [System.IO.File]::WriteAllText((Join-Path $ReleaseDir "一键启动隐藏.vbs"), $hiddenLauncher, [System.Text.Encoding]::ASCII)
$readme = @"
抖音直播评论员
版本：$DisplayVersion

使用方法：
1. 推荐双击「一键启动隐藏.vbs」启动；如果被系统拦截，再双击运行 $ExeName。
2. 在本地后台页面点击「打开直播间」，然后在受控浏览器里确认抖音登录状态。
3. 在「发送评论」流程里发送评论；手动输入模式只有点击「立即发送」后才会发送。
4. 「评论库自动」模式会先填入一条已启用且发送次数最少的评论，再按配置倒计时自动发送。默认倒计时是 30 秒。
5. 「总工作任务」达到配置次数后会自动停止继续发送；如需继续，请在「运行配置」里调大总任务数。

注意事项：
- 发布电脑不需要安装 Python。
- 电脑需要安装 Chrome 或 Edge；如果软件找不到浏览器，请在「运行配置」里填写浏览器 exe 路径。
- config.json 不保存抖音账号密码；登录状态保存在本软件自己的浏览器资料目录里。
- 评论库、直播间、账号档案、总工作任务和浏览器路径都在「运行配置」或「评论库」里维护。
"@
    [System.IO.File]::WriteAllText((Join-Path $ReleaseDir "README.txt"), $readme, [System.Text.Encoding]::UTF8)
}

function Test-ReleaseConfigIncluded {
    param(
        [string]$SourceConfigPath,
        [string]$ReleaseConfigPath
    )
    # 这个函数用于在打包时强制确认当前配置和评论库已进入发布目录，避免领导电脑首次打开还要重新配置。
    if (-not (Test-Path -LiteralPath $SourceConfigPath)) {
        throw "Source config.json not found: $SourceConfigPath"
    }
    if (-not (Test-Path -LiteralPath $ReleaseConfigPath)) {
        throw "Release config.json not found: $ReleaseConfigPath"
    }
    $sourceHash = (Get-FileHash -LiteralPath $SourceConfigPath -Algorithm SHA256).Hash
    $releaseHash = (Get-FileHash -LiteralPath $ReleaseConfigPath -Algorithm SHA256).Hash
    if ($sourceHash -ne $releaseHash) {
        throw "Release config.json is not same as source config.json."
    }
    $config = Get-Content -LiteralPath $ReleaseConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $commentCount = @($config.comments).Count
    if ($commentCount -le 0) {
        throw "Release config.json has empty comments."
    }
    $roomCount = @($config.live_rooms).Count
    if ($roomCount -le 0) {
        throw "Release config.json has empty live_rooms."
    }
    Write-ReleaseLog "verify" "config-included" "rooms=$roomCount comments=$commentCount"
}

function Compress-ReleaseArchive {
    param(
        [string]$SourceDir,
        [string]$DestinationPath
    )
    # 这个函数用于处理 PyInstaller 产物刚生成时被系统短暂扫描占用的问题；重试仍失败就暴露真实错误。
    $lastError = $null
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Compress-Archive -LiteralPath $SourceDir -DestinationPath $DestinationPath -Force
            return
        }
        catch {
            $lastError = $_
            Write-ReleaseLog "zip" "compress-retry" "attempt=$attempt reason='$($_.Exception.Message)'"
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
    throw $lastError
}

function Invoke-SelfTest {
    param([string]$PythonCommand)
    Write-ReleaseLog "self-test" "source-check"
    & $PythonCommand -B (Join-Path $Root "app_entry.py") --check
    if ($LASTEXITCODE -ne 0) {
        throw "Source self-test failed. Build stopped."
    }
}

$DisplayVersion = Get-AppVersion
$ReleaseDirName = "{0}_{1}_免环境版_{2}" -f $PackageDisplayName, $DisplayVersion, $Timestamp
$ReleaseDir = Join-Path $ReleaseRoot $ReleaseDirName
$ZipPath = "$ReleaseDir.zip"

$PythonCommand = Get-PythonCommand
Ensure-PythonModule -PythonCommand $PythonCommand -ModuleName "playwright" -PackageName "playwright>=1.52,<2"
Ensure-PythonModule -PythonCommand $PythonCommand -ModuleName "PyInstaller" -PackageName "pyinstaller>=6.7,<7"
Invoke-SelfTest -PythonCommand $PythonCommand

if ($SelfTest) {
    Write-ReleaseLog "self-test" "done" "version='$DisplayVersion' package='$ReleaseDirName'"
    exit 0
}

Move-ToBackupIfExists -TargetPath $BuildRoot
Move-ToBackupIfExists -TargetPath $DistRoot
Move-ToBackupIfExists -TargetPath $ReleaseDir
Move-ToBackupIfExists -TargetPath (Join-Path $ReleaseRoot "DouyinLiveCommenter")
Get-ChildItem -LiteralPath $ReleaseRoot -Filter "DouyinLiveCommenter_*.zip" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Move-ToBackupIfExists -TargetPath $_.FullName
}
Get-ChildItem -LiteralPath $ReleaseRoot -Filter "$PackageDisplayName`_*" -Force -ErrorAction SilentlyContinue | ForEach-Object {
    Move-ToBackupIfExists -TargetPath $_.FullName
}

New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null

$webSource = Join-Path $Root "douyin_commenter\web"
$webData = "$webSource;douyin_commenter\web"
$pyinstallerArgs = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--console",
    "--name", "DouyinLiveCommenter",
    "--contents-directory",
    "_internal",
    "--distpath", $DistRoot,
    "--workpath", (Join-Path $BuildRoot "work"),
    "--specpath", (Join-Path $BuildRoot "spec"),
    "--add-data", $webData,
    "--collect-all", "playwright",
    "--hidden-import", "playwright.sync_api",
    (Join-Path $Root "app_entry.py")
)

Write-ReleaseLog "build" "pyinstaller-start" "$PythonCommand $($pyinstallerArgs -join ' ')"
& $PythonCommand @pyinstallerArgs
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

$builtAppDir = Join-Path $DistRoot "DouyinLiveCommenter"
$builtExe = Join-Path $builtAppDir $ExeName
if (-not (Test-Path -LiteralPath $builtExe)) {
    throw "Built exe not found: $builtExe"
}

Copy-ReleaseFiles -BuiltAppDir $builtAppDir
Test-ReleaseConfigIncluded -SourceConfigPath (Join-Path $Root "config.json") -ReleaseConfigPath (Join-Path $ReleaseDir "config.json")

Compress-ReleaseArchive -SourceDir $ReleaseDir -DestinationPath $ZipPath
Write-ReleaseLog "done" "release-created" "version='$DisplayVersion' dir='$ReleaseDir' zip='$ZipPath'"
