[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 右键菜单文字“复制文件地址”，用码点拼装以避免本文件编码问题。
$verb = (-join [char[]](0x590D, 0x5236, 0x6587, 0x4EF6, 0x5730, 0x5740))
$app = Join-Path -Path $PSScriptRoot -ChildPath 'CopyQuotedPath.exe'
if (-not (Test-Path -LiteralPath $app)) {
    throw "找不到 CopyQuotedPath.exe，请把 exe 和本脚本放同一目录：$app"
}

$keys = @(
    'HKCU\Software\Classes\*\shell\Codex.CopyQuotedPath',
    'HKCU\Software\Classes\Directory\shell\Codex.CopyQuotedPath'
)

foreach ($key in $keys) {
    Write-Host "正在写入菜单键：$key"
    & reg.exe ADD $key /v MUIVerb /t REG_SZ /d $verb /f | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "写入菜单名失败：$key" }
    & reg.exe ADD $key /v Icon /t REG_SZ /d 'imageres.dll,-5302' /f | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "写入图标失败：$key" }
    $cmdKey = "$key\command"
    $cmdValue = '\"{0}\" \"%1\"' -f $app
    Write-Host "正在写入执行命令：$cmdKey"
    & reg.exe ADD $cmdKey /ve /t REG_SZ /d $cmdValue /f | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "写入执行命令失败：$cmdKey" }
}

Write-Host '安装完成，去资源管理器右键文件/文件夹验证。'
