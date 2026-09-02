#!/usr/bin/env pwsh
# 该脚本文件由发布入口加载；每个文件只负责发布流程中的一个职责。

function Write-ReleaseLog {
    param(
        [string]$Action,
        [string]$SubAction,
        [string]$Message = ""
    )
    $frame = (Get-PSCallStack)[1]
    $lineNumber = if ($frame.ScriptLineNumber) { $frame.ScriptLineNumber } else { "?" }
    $prefix = "[{0}][build_release.ps1:{1}][主线:Release:{2}][release.build][{3}]" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $lineNumber, $Action, $SubAction
    if ([string]::IsNullOrWhiteSpace($Message)) {
        Write-Host $prefix
        return
    }
    Write-Host "$prefix $Message"
}
