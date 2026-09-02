#!/usr/bin/env pwsh
# 该脚本文件由发布入口加载；每个文件只负责发布流程中的一个职责。

function Set-JsonPropertyValue {
    # 该函数用于兼容缺失字段的 JSON 对象写入，避免发布配置脱敏时因为字段不存在而漏处理。
    param(
        [object]$Target,
        [string]$Name,
        [object]$Value
    )
    if ($null -eq $Target.PSObject.Properties[$Name]) {
        $Target | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
        return
    }
    $Target.$Name = $Value
}

function Get-JsonObjectProperty {
    # 该函数用于读取或创建 JSON 子对象，确保账号密码脱敏始终落到明确的对象结构里。
    param(
        [object]$Target,
        [string]$Name,
        [string]$FieldPath
    )
    if ($null -eq $Target.PSObject.Properties[$Name] -or $null -eq $Target.$Name) {
        Set-JsonPropertyValue -Target $Target -Name $Name -Value ([pscustomobject]@{})
    }
    if (-not ($Target.$Name -is [System.Management.Automation.PSCustomObject])) {
        throw "发布配置脱敏失败：$FieldPath 必须是对象"
    }
    return $Target.$Name
}

function Export-SanitizedReleaseConfig {
    # 该函数用于生成发布包专用配置，只保留可公开运行参数，账号密码一律清空。
    param(
        [string]$SourcePath,
        [string]$DestinationPath
    )
    $config = Read-Utf8Text -Path $SourcePath | ConvertFrom-Json
    if ($null -eq $config -or -not ($config -is [System.Management.Automation.PSCustomObject])) {
        throw "发布配置脱敏失败：config.json 根节点必须是对象"
    }
    $credentials = Get-JsonObjectProperty -Target $config -Name "credentials" -FieldPath "credentials"
    foreach ($accountName in $ReleaseCredentialAccountNames) {
        $account = Get-JsonObjectProperty -Target $credentials -Name $accountName -FieldPath "credentials.$accountName"
        Set-JsonPropertyValue -Target $account -Name "username" -Value ""
        Set-JsonPropertyValue -Target $account -Name "password" -Value ""
    }
    $json = $config | ConvertTo-Json -Depth 30
    Write-Utf8Text -Path $DestinationPath -Content ($json + "`r`n")
    Write-ReleaseLog "安全" "配置脱敏" "已清空发布包 config.json 中的账号密码字段"
}
