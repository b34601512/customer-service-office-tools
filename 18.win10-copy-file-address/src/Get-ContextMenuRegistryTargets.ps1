function Get-ContextMenuRegistryTargets {
    [CmdletBinding()]
    param()

    # 统一定义右键菜单挂载位置，避免安装与卸载目标不一致。
    @(
        'HKCU\Software\Classes\*\shell\Codex.CopyQuotedPath',
        'HKCU\Software\Classes\Directory\shell\Codex.CopyQuotedPath'
    )
}
