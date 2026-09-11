@echo off
setlocal DisableDelayedExpansion
rem CopyPath TUI: self-contained, readable PowerShell payload below.
rem No downloads, elevation, permanent execution-policy changes, or helper EXEs.
set "COPY_PATH_TUI_SELF=%~f0"
set "COPY_PATH_TUI_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "COPY_PATH_TUI_PS=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%COPY_PATH_TUI_PS%" (
    echo Windows PowerShell was not found. This tool requires Windows 10.
    pause
    exit /b 1
)
"%COPY_PATH_TUI_PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $text=[IO.File]::ReadAllText($env:COPY_PATH_TUI_SELF,[Text.Encoding]::UTF8); $parts=$text -split '(?m)^#==POWERSHELL==\r?$',2; if($parts.Count -ne 2){throw 'PowerShell payload missing.'}; & ([scriptblock]::Create($parts[1]))"
set "COPY_PATH_TUI_RC=%ERRORLEVEL%"
if not "%COPY_PATH_TUI_RC%"=="0" (
    echo.
    echo The tool could not finish. Please review the error above.
    pause
)
exit /b %COPY_PATH_TUI_RC%
#==POWERSHELL==
# CopyPath TUI 1.0.0 - Windows PowerShell 5.1, Windows 10.
# Uses the installed Windows copyaspath handler, not a shell command containing filenames.
# Only this tool's unique HKCU registry key is modified. No elevation or network access.
# Platform reference: https://learn.microsoft.com/en-us/windows/win32/shell/context-menu-handlers
# Registry reference: https://learn.microsoft.com/en-us/windows/win32/sysinfo/hkey-classes-root-key
# Refresh reference: https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shchangenotify
[CmdletBinding()]
param(
    [ValidateSet('Menu', 'Install', 'Uninstall', 'Status')]
    [string]$Action = 'Menu'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:Version = '1.0.0'
$script:AppId = 'CopyPathTUI.83674e41-c68a-49d1-ae70-a428321e3c85'
$script:OwnerName = 'CopyPathTUI.Owner'
$script:MenuText = '复制文件地址'
$script:TargetKey = 'Software\Classes\AllFilesystemObjects\shell\CopyPathTUI.CopyAsPath'
$script:SourceKey = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell\Windows.copyaspath'
$script:UseKeys = $false
$script:OsInfo = $null
$script:BackupDir = ''

function Open-RegistryRoot {
    param([Microsoft.Win32.RegistryHive]$Hive)
    $view = [Microsoft.Win32.RegistryView]::Registry32
    if ([Environment]::Is64BitOperatingSystem) {
        $view = [Microsoft.Win32.RegistryView]::Registry64
    }
    return [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $view)
}

function Get-WindowsInfo {
    $root = Open-RegistryRoot -Hive LocalMachine
    $key = $null
    try {
        $key = $root.OpenSubKey('SOFTWARE\Microsoft\Windows NT\CurrentVersion', $false)
        if ($null -eq $key) { throw '无法读取 Windows 版本。' }
        $build = 0
        $valid = [int]::TryParse([string]$key.GetValue('CurrentBuildNumber', ''), [ref]$build)
        if (-not $valid) { throw '无法识别 Windows 内部版本号。' }
        $release = [string]$key.GetValue('DisplayVersion', '')
        if ([string]::IsNullOrEmpty($release)) { $release = [string]$key.GetValue('ReleaseId', '') }
        return [pscustomobject]@{
            Name = [string]$key.GetValue('ProductName', 'Windows')
            Build = $build
            Release = $release
            IsWindows10 = ($build -ge 10240 -and $build -lt 22000 -and
                [string]$key.GetValue('InstallationType', '') -eq 'Client')
        }
    }
    finally {
        if ($null -ne $key) { $key.Dispose() }
        $root.Dispose()
    }
}

function New-ValueEntry {
    param([string]$Name, [object]$Data, [Microsoft.Win32.RegistryValueKind]$Kind)
    return [pscustomobject]@{ Name = $Name; Data = $Data; Kind = $Kind }
}

function Get-Entry {
    param([object]$Snapshot, [string]$Name)
    if ($null -ne $Snapshot) {
        foreach ($entry in $Snapshot.Entries) {
            if ($entry.Name -eq $Name) { return $entry }
        }
    }
    return $null
}

function Get-TargetSnapshot {
    $root = Open-RegistryRoot -Hive CurrentUser
    $key = $null
    try {
        $key = $root.OpenSubKey($script:TargetKey, $false)
        if ($null -eq $key) { return $null }
        $entries = @(
            foreach ($name in $key.GetValueNames()) {
                New-ValueEntry -Name $name -Kind ($key.GetValueKind($name)) -Data (
                    $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                )
            }
        )
        return [pscustomobject]@{ Entries = $entries; SubKeys = @($key.GetSubKeyNames()) }
    }
    finally {
        if ($null -ne $key) { $key.Dispose() }
        $root.Dispose()
    }
}

function Assert-ManagedKey {
    param([object]$Snapshot)
    if ($null -eq $Snapshot) { return }
    $owner = Get-Entry -Snapshot $Snapshot -Name $script:OwnerName
    if ($null -eq $owner -or [string]$owner.Data -cne $script:AppId) {
        throw '同名注册项不属于本工具，已停止操作，不会覆盖或删除它。'
    }
    if ($Snapshot.SubKeys.Count -gt 0) {
        throw '本工具的注册项中存在未知子项，已停止操作。请先检查注册表，避免误删。'
    }
}

function Get-NativeDefinition {
    # Read the actual configuration supplied by this Windows installation.
    # Do not guess or install a CLSID when the native definition is absent.
    $root = Open-RegistryRoot -Hive LocalMachine
    $key = $null
    $classes = $null
    $handlerKey = $null
    try {
        $key = $root.OpenSubKey($script:SourceKey, $false)
        if ($null -eq $key) {
            throw '系统缺少原生 Windows.copyaspath 注册项；本工具不会猜测或补装系统组件。'
        }
        $verb = [string]$key.GetValue('VerbName', '')
        $handler = [string]$key.GetValue('VerbHandler', '')
        $guid = [guid]::Empty
        if ($verb -ine 'copyaspath' -or -not [guid]::TryParse($handler, [ref]$guid)) {
            throw '系统原生复制路径配置不完整，未进行安装。'
        }
        if ($key.GetValueKind('VerbHandler') -ne [Microsoft.Win32.RegistryValueKind]::String -or
            $key.GetValueKind('VerbName') -ne [Microsoft.Win32.RegistryValueKind]::String) {
            throw '系统原生复制路径配置类型异常，未进行安装。'
        }
        $classes = Open-RegistryRoot -Hive ClassesRoot
        $handlerKey = $classes.OpenSubKey(('CLSID\{0}\InprocServer32' -f $guid.ToString('B')), $false)
        if ($null -eq $handlerKey -or [string]::IsNullOrWhiteSpace([string]$handlerKey.GetValue('', ''))) {
            throw '系统原生复制路径处理程序未注册，未进行安装。'
        }
        $names = @($key.GetValueNames())
        $entries = @(
            # Do not copy Extended, LegacyDisable, or ProgrammaticAccessOnly.
            foreach ($name in @('CanonicalName', 'CommandStateHandler', 'CommandStateSync',
                    'Description', 'Icon', 'VerbHandler', 'VerbName')) {
                if ($names -contains $name) {
                    New-ValueEntry -Name $name -Kind ($key.GetValueKind($name)) -Data (
                        $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                    )
                }
            }
            New-ValueEntry -Name 'InvokeCommandOnSelection' -Data ([int]1) -Kind DWord
            New-ValueEntry -Name 'MultiSelectModel' -Data 'Player' -Kind String
            New-ValueEntry -Name 'MUIVerb' -Data $script:MenuText -Kind String
            New-ValueEntry -Name 'Position' -Data 'Top' -Kind String
            New-ValueEntry -Name $script:OwnerName -Data $script:AppId -Kind String
            New-ValueEntry -Name 'CopyPathTUI.Version' -Data $script:Version -Kind String
        )
        return [pscustomobject]@{ Entries = $entries; SubKeys = @() }
    }
    finally {
        if ($null -ne $handlerKey) { $handlerKey.Dispose() }
        if ($null -ne $classes) { $classes.Dispose() }
        if ($null -ne $key) { $key.Dispose() }
        $root.Dispose()
    }
}

function Test-DefinitionMatch {
    param([object]$Actual, [object]$Expected)
    if ($null -eq $Actual -or $Actual.SubKeys.Count -ne 0 -or
        $Actual.Entries.Count -ne $Expected.Entries.Count) { return $false }
    foreach ($want in $Expected.Entries) {
        $have = Get-Entry -Snapshot $Actual -Name $want.Name
        if ($null -eq $have -or $have.Kind -ne $want.Kind -or $have.Data -cne $want.Data) {
            return $false
        }
    }
    return $true
}

function Get-InstallStatus {
    try {
        $actual = Get-TargetSnapshot
        if ($null -eq $actual) {
            return [pscustomobject]@{ Text = '未安装'; Color = 'Yellow'; Detail = '尚未创建本工具的菜单。' }
        }
        Assert-ManagedKey -Snapshot $actual
        $expected = Get-NativeDefinition
        if (Test-DefinitionMatch -Actual $actual -Expected $expected) {
            return [pscustomobject]@{ Text = '已安装'; Color = 'Green'; Detail = '注册配置匹配；实际复制效果请到资源管理器验证。' }
        }
        return [pscustomobject]@{ Text = '需要修复'; Color = 'Yellow'; Detail = '注册配置不一致，可选择“安装 / 修复”。' }
    }
    catch {
        return [pscustomobject]@{ Text = '检查异常'; Color = 'Red'; Detail = $_.Exception.Message }
    }
}

function Backup-TargetKey {
    param([string]$Operation)
    [void][IO.Directory]::CreateDirectory($script:BackupDir)
    $suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $fileName = '{0}-{1}-{2}.reg' -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), $Operation, $suffix
    $path = Join-Path $script:BackupDir $fileName
    $regExe = Join-Path $env:SystemRoot 'System32\reg.exe'
    if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
        $regExe = Join-Path $env:SystemRoot 'Sysnative\reg.exe'
    }
    $result = & $regExe export ('HKCU\' + $script:TargetKey) $path /y 2>&1
    if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($path)) {
        throw ('备份失败，未修改注册表。详情：' + ($result -join ' '))
    }
    return $path
}

function Set-TargetSnapshot {
    param([AllowNull()][object]$Snapshot)
    # Caller must validate ownership and back up BEFORE calling this function.
    # Only the unique leaf key is removed; no parent shell or Classes keys are deleted.
    $root = Open-RegistryRoot -Hive CurrentUser
    $key = $null
    try {
        $root.DeleteSubKeyTree($script:TargetKey, $false)
        if ($null -ne $Snapshot) {
            $key = $root.CreateSubKey($script:TargetKey)
            # Keep partially written menus hidden until every value is in place.
            $key.SetValue('LegacyDisable', '', [Microsoft.Win32.RegistryValueKind]::String)
            foreach ($entry in $Snapshot.Entries) {
                $key.SetValue($entry.Name, $entry.Data, $entry.Kind)
            }
            if ($null -eq (Get-Entry -Snapshot $Snapshot -Name 'LegacyDisable')) {
                $key.DeleteValue('LegacyDisable', $false)
            }
            $key.Flush()
        }
    }
    finally {
        if ($null -ne $key) { $key.Dispose() }
        $root.Dispose()
    }
}

function Send-ShellRefresh {
    try {
        if ($null -eq ('CopyPathTUI.NativeShell' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CopyPathTUI {
    public static class NativeShell {
        [DllImport("shell32.dll", ExactSpelling = true)]
        public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
    }
}
'@
        }
        # SHCNE_ASSOCCHANGED | SHCNF_IDLIST | SHCNF_FLUSHNOWAIT.
        [CopyPathTUI.NativeShell]::SHChangeNotify(0x08000000, 0x2000, [IntPtr]::Zero, [IntPtr]::Zero)
        return '已通知资源管理器刷新，请关闭右键菜单后重新右键。'
    }
    catch {
        # Registry changes remain valid even if a policy blocks Add-Type.
        return '注册表操作已完成，但刷新通知失败。请关闭并重新打开资源管理器后验证。'
    }
}

function Invoke-MenuChange {
    param([ValidateSet('Install', 'Uninstall')][string]$Operation)
    $mutex = $null
    $locked = $false
    $backup = ''
    try {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $mutex = [System.Threading.Mutex]::new($false, ('Local\CopyPathTUI.' + $sid))
        try { $locked = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw '另一个窗口正在修改此菜单，请在该窗口完成操作后重试。' }

        $before = Get-TargetSnapshot
        Assert-ManagedKey -Snapshot $before
        $desired = $null
        if ($Operation -eq 'Install') {
            if (-not $script:OsInfo.IsWindows10) {
                throw '安装功能仅面向 Windows 10。其他系统可检查或卸载，但不会新增菜单。'
            }
            $desired = Get-NativeDefinition
            if (Test-DefinitionMatch -Actual $before -Expected $desired) {
                return [pscustomobject]@{ Message = '已安装且配置一致，无需重复写入。'; Backup = ''; Refresh = (Send-ShellRefresh) }
            }
        }
        elseif ($null -eq $before) {
            return [pscustomobject]@{ Message = '未发现本工具的菜单，无需卸载。'; Backup = ''; Refresh = '' }
        }

        # For a first install there is no old leaf key to back up.
        if ($null -ne $before) { $backup = Backup-TargetKey -Operation $Operation }
        try {
            Set-TargetSnapshot -Snapshot $desired
            $after = Get-TargetSnapshot
            if ($Operation -eq 'Install') {
                if (-not (Test-DefinitionMatch -Actual $after -Expected $desired)) {
                    throw '写入后的注册表校验失败。'
                }
            }
            elseif ($null -ne $after) { throw '卸载后的注册表校验失败。' }
        }
        catch {
            $originalError = $_.Exception.Message
            try { Set-TargetSnapshot -Snapshot $before }
            catch {
                throw ('操作失败，自动回滚也失败。原错误：{0}；回滚错误：{1}；备份：{2}' -f
                    $originalError, $_.Exception.Message, $backup)
            }
            [void](Send-ShellRefresh)
            throw ('操作失败，已恢复操作前的注册配置：' + $originalError)
        }
        $message = '安装完成。请对文件或文件夹右键，选择“复制文件地址”。'
        if ($Operation -eq 'Uninstall') { $message = '卸载完成。只删除了本工具创建的菜单项，备份仍保留。' }
        return [pscustomobject]@{ Message = $message; Backup = $backup; Refresh = (Send-ShellRefresh) }
    }
    finally {
        if ($locked -and $null -ne $mutex) { $mutex.ReleaseMutex() }
        if ($null -ne $mutex) { $mutex.Dispose() }
    }
}

function Show-Header {
    param([string]$Page = '控制台')
    try { Clear-Host } catch { }
    Write-Host ''
    Write-Host '  COPY PATH  /  右键复制文件地址' -ForegroundColor Cyan
    Write-Host ('  Windows 10  ·  v{0}  ·  {1}' -f $script:Version, $Page) -ForegroundColor DarkGray
    Write-Host ('  ' + ('-' * 60)) -ForegroundColor DarkCyan
}

function Wait-ForReturn {
    Write-Host ''
    if ($script:UseKeys) {
        Write-Host '  按任意键返回菜单...' -ForegroundColor DarkGray
        [void][Console]::ReadKey($true)
    }
    else { [void](Read-Host '  按回车返回菜单') }
}

function Confirm-MenuAction {
    param([string]$Message)
    Write-Host ''
    Write-Host ('  ' + $Message) -ForegroundColor Yellow
    Write-Host '  仅输入 Y 确认；其他输入取消。' -ForegroundColor DarkGray
    $answer = Read-Host '  确认'
    return ([string]$answer).Trim() -ieq 'Y'
}

function Show-StatusPage {
    $state = Get-InstallStatus
    Write-Host ('  菜单状态：' + $state.Text) -ForegroundColor $state.Color
    Write-Host ('  ' + $state.Detail)
    Write-Host ''
    Write-Host ('  系统：{0} {1} / Build {2}' -f $script:OsInfo.Name, $script:OsInfo.Release, $script:OsInfo.Build)
    Write-Host ('  PowerShell：' + $PSVersionTable.PSVersion.ToString())
    Write-Host ('  当前用户：' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
    Write-Host '  修改范围：当前用户 HKCU；不修改系统自带的菜单项。'
    Write-Host '  注册表位置：' -ForegroundColor Cyan
    Write-Host ('  HKEY_CURRENT_USER\' + $script:TargetKey)
    Write-Host '  备份目录：' -ForegroundColor Cyan
    Write-Host ('  ' + $script:BackupDir)
    try {
        [void](Get-NativeDefinition)
        Write-Host '  原生复制路径配置：可读取，处理程序已注册。' -ForegroundColor Green
    }
    catch { Write-Host ('  原生配置：' + $_.Exception.Message) -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '  此页面只检查注册配置，不会读取或覆盖剪贴板。' -ForegroundColor DarkGray
    Write-Host '  配置正常不等于实机复制测试通过，请按使用说明验证。' -ForegroundColor DarkGray
}

function Show-HelpPage {
    Write-Host '  安装后怎么用' -ForegroundColor Cyan
    Write-Host '  选中文件或文件夹 → 直接右键 → 复制文件地址。'
    Write-Host '  在记事本中按 Ctrl+V 检查结果。'
    Write-Host '  使用系统原生带引号的完整路径；多选交给系统统一处理。'
    Write-Host '  示例："D:\资料\测试 文件.txt"'
    Write-Host ''
    Write-Host '  建议检查' -ForegroundColor Cyan
    Write-Host '  分别测试单个文件、文件夹、多选、中文和带空格的名称。'
    Write-Host '  针对选中的文件系统对象，不添加文件夹空白处菜单。'
    Write-Host ''
    Write-Host '  安全与恢复' -ForegroundColor Cyan
    Write-Host '  不需管理员、不联网、不驻留，不改系统的复制路径组件。'
    Write-Host '  修复或卸载已有项前导出 .reg 备份；失败时尝试自动回滚。'
    Write-Host '  不会强制重启资源管理器，也不会关闭你打开的文件夹。'
    Write-Host '  安装后可移动或删除本脚本；卸载时重新运行本脚本即可。'
    Write-Host '  旧脚本或其他软件创建的重复菜单不会自动清理。'
    Write-Host ''
    Write-Host '  适用：Windows 10 + Windows PowerShell 5.1。' -ForegroundColor DarkGray
    Write-Host '  本版本尚未完成 Windows 10 实机验证。' -ForegroundColor Yellow
}

function Show-ChangeResult {
    param([object]$Result)
    Write-Host ('  ' + $Result.Message) -ForegroundColor Green
    if (-not [string]::IsNullOrEmpty($Result.Refresh)) { Write-Host ('  ' + $Result.Refresh) }
    if (-not [string]::IsNullOrEmpty($Result.Backup)) {
        Write-Host '  操作前备份已保留：' -ForegroundColor Cyan
        Write-Host ('  ' + $Result.Backup)
    }
}

function Show-MainMenu {
    $selected = 0
    $labels = @('安装 / 修复', '卸载本工具', '状态检查', '使用说明', '退出')
    $hints = @('添加常显菜单，重复运行不会重复添加', '仅移除本工具创建的菜单项',
        '查看注册配置、系统信息和备份位置', '查看使用方法、限制和恢复方式', '关闭工具，不影响已安装的菜单')
    $digits = @('1', '2', '3', '4', '0')
    while ($true) {
        $state = Get-InstallStatus
        Show-Header
        Write-Host ('  当前状态：' + $state.Text) -ForegroundColor $state.Color
        Write-Host '  仅当前用户  /  无需管理员  /  系统原生复制'
        Write-Host ''
        for ($i = 0; $i -lt $labels.Count; $i++) {
            $line = '   [{0}] {1}' -f $digits[$i], $labels[$i]
            if ($i -eq $selected) {
                Write-Host (' >' + $line + '   ') -ForegroundColor Black -BackgroundColor Cyan
            }
            else { Write-Host ('  ' + $line) -ForegroundColor Gray }
        }
        Write-Host ''
        Write-Host ('  ' + $hints[$selected]) -ForegroundColor DarkGray
        Write-Host ('  ' + ('-' * 60)) -ForegroundColor DarkCyan
        Write-Host '  ↑↓ 选择  ·  Enter 确认  ·  数字直选  ·  Esc 退出' -ForegroundColor DarkGray

        if ($script:UseKeys) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::UpArrow) {
                $selected = ($selected + $labels.Count - 1) % $labels.Count
                continue
            }
            if ($key.Key -eq [ConsoleKey]::DownArrow) {
                $selected = ($selected + 1) % $labels.Count
                continue
            }
            if ($key.Key -eq [ConsoleKey]::Escape -or [string]$key.KeyChar -ieq 'q') { return }
            if ($key.Key -ne [ConsoleKey]::Enter) {
                $index = [Array]::IndexOf($digits, [string]$key.KeyChar)
                if ($index -lt 0) { continue }
                $selected = $index
            }
        }
        else {
            $answer = Read-Host '  输入数字'
            if ([string]::IsNullOrWhiteSpace([string]$answer)) { return }
            $index = [Array]::IndexOf($digits, ([string]$answer).Trim())
            if ($index -lt 0) { continue }
            $selected = $index
        }
        if ($selected -eq 4) { return }
        Show-Header -Page $labels[$selected]
        try {
            switch ($selected) {
                0 {
                    if (Confirm-MenuAction '将为当前账户安装 / 修复“复制文件地址”菜单。') {
                        Show-ChangeResult -Result (Invoke-MenuChange -Operation Install)
                    }
                    else { Write-Host '  已取消，没有修改注册表。' -ForegroundColor DarkGray }
                }
                1 {
                    if (Confirm-MenuAction '将卸载本工具创建的菜单。已有项会先备份。') {
                        Show-ChangeResult -Result (Invoke-MenuChange -Operation Uninstall)
                    }
                    else { Write-Host '  已取消，没有修改注册表。' -ForegroundColor DarkGray }
                }
                2 { Show-StatusPage }
                3 { Show-HelpPage }
            }
        }
        catch {
            Write-Host ('  操作未完成：' + $_.Exception.Message) -ForegroundColor Red
            Write-Host '  不要关闭安全软件或绕过单位策略；请先查看错误原因。' -ForegroundColor DarkGray
        }
        Wait-ForReturn
    }
}

# Entry point. Loading the menu and checking status never installs anything.
$exitCode = 0
$oldTitle = $null
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw '此脚本只能在 Windows 中运行。'
    }
    if ($PSVersionTable.PSVersion -lt [version]'5.1') {
        throw '需要 Windows PowerShell 5.1 或更高版本。'
    }
    if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
        throw '当前 PowerShell 受组织安全策略限制，请联系管理员；本工具不会绕过此限制。'
    }
    $script:OsInfo = Get-WindowsInfo
    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrEmpty($localAppData)) { throw '无法确定当前用户的本地应用数据目录。' }
    $script:BackupDir = Join-Path $localAppData 'CopyPathTUI\Backups'
    try {
        $script:UseKeys = ($Host.Name -eq 'ConsoleHost' -and -not [Console]::IsInputRedirected)
        if ($Action -eq 'Menu') {
            [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
            $oldTitle = $Host.UI.RawUI.WindowTitle
            $Host.UI.RawUI.WindowTitle = '右键复制文件地址 | CopyPath TUI'
        }
    }
    catch { $script:UseKeys = $false }
    switch ($Action) {
        'Menu' { Show-MainMenu }
        'Install' { Show-ChangeResult -Result (Invoke-MenuChange -Operation Install) }
        'Uninstall' { Show-ChangeResult -Result (Invoke-MenuChange -Operation Uninstall) }
        'Status' { Show-StatusPage }
    }
}
catch {
    $exitCode = 1
    Write-Host ('错误：' + $_.Exception.Message) -ForegroundColor Red
}
finally {
    if ($null -ne $oldTitle) {
        try { $Host.UI.RawUI.WindowTitle = $oldTitle } catch { }
    }
}
exit $exitCode
