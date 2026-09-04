[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$keys = @(
    'HKCU\Software\Classes\*\shell\Codex.CopyQuotedPath',
    'HKCU\Software\Classes\Directory\shell\Codex.CopyQuotedPath'
)

foreach ($key in $keys) {
    & reg.exe QUERY $key 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "正在删除菜单键：$key"
        & reg.exe DELETE $key /f | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "删除注册表失败：$key" }
    } else {
        Write-Host "菜单键不存在，跳过：$key"
    }
}

Write-Host '卸载完成。'
