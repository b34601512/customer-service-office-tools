#!/usr/bin/env pwsh
# 该脚本文件由发布入口加载；每个文件只负责发布流程中的一个职责。

function Move-ToBackupIfExists {
    param([string]$TargetPath)
    if (-not (Test-Path -LiteralPath $TargetPath)) {
        return
    }
    $name = Split-Path -Leaf $TargetPath
    New-Item -ItemType Directory -Path $BackupBase -Force | Out-Null
    $destination = Join-Path $BackupBase $name
    Write-ReleaseLog "备份" "移动旧产物" "from='$TargetPath' to='$destination'"
    Move-Item -LiteralPath $TargetPath -Destination $destination
}
