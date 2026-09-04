[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Write-StepLog.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Get-ContextMenuRegistryTargets.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Invoke-RegExe.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Publish-CopyQuotedPathApp.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'src\Install-CopyQuotedPathContextMenu.ps1')

# 调度安装流程，确保右键菜单注册逻辑集中在独立模块内。
Write-StepLog -MainAction '安装' -ModuleName '入口' -SubAction '开始安装右键菜单'
Install-CopyQuotedPathContextMenu -ProjectRoot $PSScriptRoot
Write-StepLog -MainAction '安装' -ModuleName '入口' -SubAction '安装完成，请直接到资源管理器右键验证'
