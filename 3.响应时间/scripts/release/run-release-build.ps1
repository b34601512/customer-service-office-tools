#!/usr/bin/env pwsh
# 该脚本负责串起发布流程，具体动作都下沉到 scripts/release 里的单职责文件。

function Invoke-ReleaseBuild {
    param(
        [string]$ProjectRoot,
        [string]$Version = "",
        [switch]$SelfTest
    )

    $ErrorActionPreference = "Stop"
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8

    $Root = $ProjectRoot
    $Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $ProjectDriveRoot = [System.IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $Root).Path)
    if ([string]::IsNullOrWhiteSpace($ProjectDriveRoot)) {
        throw "备份路径初始化失败：无法识别项目所在硬盘根目录"
    }
    $BackupBase = Join-Path (Join-Path $ProjectDriveRoot "备份文件夹") ("响应时间_发布旧包_" + $Timestamp)
    $BuildRoot = Join-Path $Root ".pyinstaller_build"
    $DistRoot = Join-Path $Root "dist"
    $ReleaseRoot = Join-Path $Root "发布包"
    $WebAssetsPath = Join-Path $Root "clipboard_relay\web_control\web"
    $AppEntryPath = Join-Path $Root "app_entry.py"
    $AppMetadataPath = Join-Path $Root "clipboard_relay\app_metadata.py"
    $ReleaseCredentialAccountNames = @("web_client", "jd_service")
    $ForbiddenReleasePathPattern = '(?i)(^|[\/])(runtime|browser_profiles)([\/]|$)|(^|[\/])(Login Data|Login Data-journal|Login Data For Account|Login Data For Account-journal|Account Web Data|Account Web Data-journal|Cookies|Cookies-journal|Device Bound Sessions|Device Bound Sessions-journal|Trust Tokens|Trust Tokens-journal|Safe Browsing Cookies|Safe Browsing Cookies-journal|passkey_enclave_state|Local State)([\/]|$)|(^|[\/])Sessions([\/]|$)|(^|[\/])(\.env|\.npmrc|\.pypirc|credentials?\.json|secrets?\.json|tokens?\.json)([\/]|$)'

$currentVersion = Get-AppVersion
$PythonSpec = Get-PythonCommandSpec
if ($SelfTest) {
    Write-ReleaseLog "自检" "脚本加载成功" "version='v$currentVersion'"
    Invoke-ReleaseSafetySelfTest
    Write-Output "BUILD_RELEASE_SELF_TEST_OK"
    exit 0
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    Write-Host ""
    $Version = Read-Host "请输入发布版本号（当前 v$currentVersion，直接回车沿用当前版本）"
}
$normalizedVersion = Normalize-Version -RawVersion $Version -CurrentVersion $currentVersion
$displayVersion = "v$normalizedVersion"

if ($normalizedVersion -ne $currentVersion) {
    Write-ReleaseLog "版本" "更新版本号" "from='v$currentVersion' to='$displayVersion'"
    Set-AppVersion -NewVersion $normalizedVersion
} else {
    Write-ReleaseLog "版本" "沿用版本号" "version='$displayVersion'"
}

$ReleaseDir = Join-Path $ReleaseRoot ("响应时间_{0}_免环境版_{1}" -f $displayVersion, $Timestamp)
$ZipPath = "$ReleaseDir.zip"

Write-ReleaseLog "测试" "开始自动测试" "$($PythonSpec.Display) -m unittest discover -s tests"
$testArgs = @($PythonSpec.PrefixArgs) + @("-m", "unittest", "discover", "-s", "tests")
& $PythonSpec.Command @testArgs
if ($LASTEXITCODE -ne 0) {
    throw "自动测试失败，已停止打包，退出码：$LASTEXITCODE"
}
Write-ReleaseLog "测试" "自动测试通过"
$PyInstallerSpec = Get-PyInstallerCommandSpec -DefaultPythonSpec $PythonSpec

Write-ReleaseLog "清理" "准备旧产物备份"
Move-ToBackupIfExists -TargetPath $BuildRoot
Move-ToBackupIfExists -TargetPath $DistRoot

New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null

$PyInstallerArgs = @(
    "-m",
    "PyInstaller"
)
$LocalSitePackagesPath = Join-Path $Root "runtime\python_env\Lib\site-packages"
if (Test-Path -LiteralPath $LocalSitePackagesPath) {
    $PyInstallerArgs += @("--paths", $LocalSitePackagesPath)
}
$PyInstallerArgs += @(
    "--noconfirm",
    "--clean",
    "--onedir",
    "--console",
    "--name",
    "响应时间",
    "--contents-directory",
    "_internal",
    "--distpath",
    $DistRoot,
    "--workpath",
    (Join-Path $BuildRoot "work"),
    "--specpath",
    (Join-Path $BuildRoot "spec"),
    "--collect-all",
    "playwright",
    "--hidden-import",
    "playwright.sync_api",
    "--add-data",
    "${WebAssetsPath};clipboard_relay\web_control\web",
    $AppEntryPath
)

Write-ReleaseLog "打包" "开始PyInstaller" "version='$displayVersion'"
$fullPyInstallerArgs = @($PyInstallerSpec.PrefixArgs) + @($PyInstallerArgs)
& $PyInstallerSpec.Command @fullPyInstallerArgs
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller 打包失败，退出码：$LASTEXITCODE"
}

$BuiltDir = Join-Path $DistRoot "响应时间"
if (-not (Test-Path -LiteralPath $BuiltDir)) {
    throw "未找到打包结果目录：$BuiltDir"
}

Write-ReleaseLog "发布" "复制发布文件" "to='$ReleaseDir'"
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
Copy-Item -Path (Join-Path $BuiltDir "*") -Destination $ReleaseDir -Recurse -Force
Export-SanitizedReleaseConfig -SourcePath (Join-Path $Root "config.json") -DestinationPath (Join-Path $ReleaseDir "config.json")
Copy-Item -LiteralPath (Join-Path $Root "README.md") -Destination (Join-Path $ReleaseDir "README.md") -Force

$NoConsoleLauncherContent = @'
Option Explicit

Dim shell
Dim fileSystem
Dim root
Dim appPath
Dim command
Dim exitCode
Dim file

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

root = fileSystem.GetParentFolderName(WScript.ScriptFullName)
appPath = ""

For Each file In fileSystem.GetFolder(root).Files
    If LCase(fileSystem.GetExtensionName(file.Name)) = "exe" Then
        appPath = file.Path
        Exit For
    End If
Next

If Len(appPath) = 0 Then
    shell.Popup "Start failed. Missing executable.", 10, "ResponseTime", 16
    WScript.Quit 1
End If

command = Quote(appPath)
If WScript.Arguments.Count > 0 Then
    command = command & " " & Quote(WScript.Arguments(0))
End If

exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
    shell.Popup "Start failed. See:" & vbCrLf & fileSystem.BuildPath(root, "logs\last_startup.log"), 10, "ResponseTime", 16
End If

WScript.Quit exitCode

Function Quote(ByVal text)
    Quote = Chr(34) & Replace(CStr(text), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
'@
Write-Utf8Text -Path (Join-Path $ReleaseDir "响应时间-无黑窗.vbs") -Content $NoConsoleLauncherContent

$GuideContent = @(
    "响应时间免环境版使用说明",
    "",
    "版本：$displayVersion",
    "",
    "1. 日常使用直接双击「响应时间-无黑窗.vbs」，启动时不会显示黑窗。",
    "2. 如果需要看实时输出，再双击「响应时间.exe」排障。",
    "3. 首次进入后先点「准备网页登录」，等两个页面都就绪后再点「启动」。",
    "4. 目标电脑不需要安装 Python。",
    "5. 目标电脑需要可用的 Chrome 或 Edge；Windows 自带 Edge 一般即可直接使用。",
    "6. 发布包 config.json 已清空账号密码，首次使用请在后台重新填写。",
    "7. 如果启动失败，请查看 logs\last_startup.log。"
) -join "`r`n"
Set-Content -LiteralPath (Join-Path $ReleaseDir "使用说明.txt") -Value $GuideContent -Encoding UTF8

Assert-NoSensitiveReleaseDirectoryContent -ReleaseDir $ReleaseDir

if (Test-Path -LiteralPath $ZipPath) {
    Move-ToBackupIfExists -TargetPath $ZipPath
}
Write-ReleaseLog "压缩" "生成压缩包" "zip='$ZipPath'"
Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $ZipPath -Force
Assert-NoSensitiveReleaseZipContent -ZipPath $ZipPath

Write-Host ""
Write-Host "打包完成："
Write-Host "版本：$displayVersion"
Write-Host "目录：$ReleaseDir"
Write-Host "压缩包：$ZipPath"
}
