#!/usr/bin/env pwsh
# 该脚本文件由发布入口加载；每个文件只负责发布流程中的一个职责。

function Get-AppVersion {
    $content = Read-Utf8Text -Path $AppMetadataPath
    $match = [regex]::Match($content, '(?m)^\s*version\s*=\s*"([^"]+)"')
    if (-not $match.Success) {
        throw "读取版本失败：未在 $AppMetadataPath 找到 version 字段"
    }
    return $match.Groups[1].Value
}

function Normalize-Version {
    param(
        [string]$RawVersion,
        [string]$CurrentVersion
    )
    $value = [string]$RawVersion
    $value = $value.Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = $CurrentVersion
    }
    if ($value.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
        $value = $value.Substring(1)
    }
    if ($value -notmatch '^\d+\.\d+(\.\d+)?$') {
        throw "版本号格式错误：请输入 v0.03 或 0.03 这种格式，当前输入=$RawVersion"
    }
    return $value
}

function Set-AppVersion {
    param([string]$NewVersion)
    $content = Read-Utf8Text -Path $AppMetadataPath
    $regex = New-Object System.Text.RegularExpressions.Regex -ArgumentList '(?m)(^\s*version\s*=\s*")[^"]+(",\s*$)', ([System.Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $regex.IsMatch($content)) {
        throw "写入版本失败：未在 $AppMetadataPath 找到可替换的 version 字段"
    }
    $newContent = $regex.Replace($content, "`${1}$NewVersion`${2}", 1)
    Write-Utf8Text -Path $AppMetadataPath -Content $newContent
}
