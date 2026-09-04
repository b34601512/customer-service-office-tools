[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'Write-StepLog.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'Set-ClipboardText.ps1')

# 校验输入路径并复制成 Win11「复制文件地址」同款的带双引号完整路径。
Write-StepLog -MainAction '执行' -ModuleName '剪贴板' -SubAction "收到目标路径：$TargetPath"
if (-not (Test-Path -LiteralPath $TargetPath)) {
    throw "目标路径不存在：$TargetPath"
}

$resolvedPath = (Resolve-Path -LiteralPath $TargetPath).Path
$quotedPath = '"{0}"' -f $resolvedPath
Write-StepLog -MainAction '执行' -ModuleName '剪贴板' -SubAction "写入剪贴板：$quotedPath"
Set-ClipboardText -Text $quotedPath
