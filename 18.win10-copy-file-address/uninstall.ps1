[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Write-StepLog.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Get-ContextMenuRegistryTargets.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Invoke-RegExe.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Uninstall-CopyQuotedPathContextMenu.ps1')

# 调度卸载流程，确保当前项目写入的右键菜单可以一键清理。
Write-StepLog -MainAction '卸载' -ModuleName '入口' -SubAction '开始卸载右键菜单'
Uninstall-CopyQuotedPathContextMenu
Write-StepLog -MainAction '卸载' -ModuleName '入口' -SubAction '卸载完成'
