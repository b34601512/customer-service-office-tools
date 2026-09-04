function Uninstall-CopyQuotedPathContextMenu {
    [CmdletBinding()]
    param()

    # 删除当前项目写入的右键菜单注册表，确保系统可以干净回滚。
    foreach ($registryKey in Get-ContextMenuRegistryTargets) {
        & reg.exe QUERY $registryKey 1>$null 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-StepLog -MainAction '卸载' -ModuleName '注册表' -SubAction "删除菜单键：$registryKey"
            Invoke-RegExe -Arguments @('DELETE', $registryKey, '/f') | Out-Null
            continue
        }

        Write-StepLog -MainAction '卸载' -ModuleName '注册表' -SubAction "菜单键不存在，跳过：$registryKey"
    }
}
