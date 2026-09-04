function Install-CopyQuotedPathContextMenu {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    # 写入右键菜单注册表，让文件和文件夹都能一键复制带双引号的完整路径。
    $applicationPath = Publish-CopyQuotedPathApp -ProjectRoot $ProjectRoot

    $commandValue = '\"{0}\" \"%1\"' -f $applicationPath
    foreach ($registryKey in Get-ContextMenuRegistryTargets) {
        Write-StepLog -MainAction '安装' -ModuleName '注册表' -SubAction "写入菜单键：$registryKey"
        Invoke-RegExe -Arguments @('ADD', $registryKey, '/v', 'MUIVerb', '/t', 'REG_SZ', '/d', '复制文件地址', '/f') | Out-Null
        Invoke-RegExe -Arguments @('ADD', $registryKey, '/v', 'Icon', '/t', 'REG_SZ', '/d', 'imageres.dll,-5302', '/f') | Out-Null

        $commandRegistryKey = '{0}\command' -f $registryKey
        Write-StepLog -MainAction '安装' -ModuleName '注册表' -SubAction "写入执行命令：$commandRegistryKey"
        Invoke-RegExe -Arguments @('ADD', $commandRegistryKey, '/ve', '/t', 'REG_SZ', '/d', $commandValue, '/f') | Out-Null
    }
}
