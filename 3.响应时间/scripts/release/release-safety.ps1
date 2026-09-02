#!/usr/bin/env pwsh
# 该脚本文件由发布入口加载；每个文件只负责发布流程中的一个职责。

function Test-ForbiddenReleasePath {
    # 该函数用于识别绝不应该进入发布包的个人运行时文件，例如浏览器 Profile、Cookie 和登录库。
    param([string]$Path)
    $normalizedPath = ($Path -replace '\\', '/').TrimStart("/")
    return $normalizedPath -match $ForbiddenReleasePathPattern
}

function Get-RelativeReleasePath {
    # 该函数用于把绝对路径压缩成发布目录内相对路径，让安全报错能直接指向问题文件。
    param(
        [string]$BasePath,
        [string]$TargetPath
    )
    $baseFullPath = [System.IO.Path]::GetFullPath($BasePath).TrimEnd([char[]]@('\', '/'))
    $targetFullPath = [System.IO.Path]::GetFullPath($TargetPath)
    $prefix = $baseFullPath + [System.IO.Path]::DirectorySeparatorChar
    if ($targetFullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $targetFullPath.Substring($prefix.Length)
    }
    return $targetFullPath
}

function Assert-ConfigTextHasNoCredentials {
    # 该函数用于检查发布版 config.json，发现非空账号或密码就立刻中止打包。
    param(
        [string]$Content,
        [string]$SourceName
    )
    $config = $Content | ConvertFrom-Json
    if ($null -eq $config -or $null -eq $config.PSObject.Properties["credentials"]) {
        return
    }
    $violations = @()
    foreach ($accountName in $ReleaseCredentialAccountNames) {
        $account = $config.credentials.$accountName
        if ($null -eq $account) {
            continue
        }
        foreach ($fieldName in @("username", "password")) {
            $value = $account.$fieldName
            if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
                $violations += "credentials.$accountName.$fieldName"
            }
        }
    }
    if ($violations.Count -gt 0) {
        throw "发布安全检查失败：$SourceName 仍含账号密码字段：$($violations -join ', ')"
    }
}

function Assert-NoSensitiveReleaseDirectoryContent {
    # 该函数用于扫描发布目录，防止个人浏览器数据或未脱敏配置被写入发布产物。
    param([string]$ReleaseDir)
    $badPaths = @()
    Get-ChildItem -LiteralPath $ReleaseDir -Recurse -Force -File | ForEach-Object {
        $relativePath = Get-RelativeReleasePath -BasePath $ReleaseDir -TargetPath $_.FullName
        if (Test-ForbiddenReleasePath -Path $relativePath) {
            $badPaths += $relativePath
        }
    }
    if ($badPaths.Count -gt 0) {
        $shownPaths = ($badPaths | Select-Object -First 8) -join "; "
        throw "发布安全检查失败：发布目录包含敏感文件：$shownPaths"
    }
    $releaseConfigPath = Join-Path $ReleaseDir "config.json"
    if (-not (Test-Path -LiteralPath $releaseConfigPath)) {
        throw "发布安全检查失败：发布目录缺少 config.json，无法确认配置已脱敏"
    }
    Assert-ConfigTextHasNoCredentials -Content (Read-Utf8Text -Path $releaseConfigPath) -SourceName "发布目录 config.json"
    Write-ReleaseLog "安全" "发布目录检查通过" "未发现账号密码、Cookie、登录库或浏览器 Profile"
}

function Assert-NoSensitiveReleaseZipContent {
    # 该函数用于扫描最终 zip，确保压缩包里的内容和发布目录一样干净。
    param([string]$ZipPath)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $badPaths = @()
        foreach ($entry in $zipArchive.Entries) {
            if (Test-ForbiddenReleasePath -Path $entry.FullName) {
                $badPaths += $entry.FullName
            }
        }
        if ($badPaths.Count -gt 0) {
            $shownPaths = ($badPaths | Select-Object -First 8) -join "; "
            throw "发布安全检查失败：压缩包包含敏感文件：$shownPaths"
        }
        $configEntry = $zipArchive.Entries | Where-Object { (($_.FullName -replace '\\', '/') -eq "config.json") } | Select-Object -First 1
        if ($null -eq $configEntry) {
            throw "发布安全检查失败：压缩包缺少 config.json，无法确认配置已脱敏"
        }
        $reader = New-Object System.IO.StreamReader($configEntry.Open(), [System.Text.Encoding]::UTF8, $true)
        try {
            Assert-ConfigTextHasNoCredentials -Content $reader.ReadToEnd() -SourceName "压缩包 config.json"
        } finally {
            $reader.Dispose()
        }
    } finally {
        $zipArchive.Dispose()
    }
    Write-ReleaseLog "安全" "压缩包检查通过" "未发现账号密码、Cookie、登录库或浏览器 Profile"
}

function Invoke-ReleaseSafetySelfTest {
    # 该函数用于自测脱敏和敏感文件拦截规则，避免安全逻辑以后被改坏。
    $selfTestRoot = Join-Path $BuildRoot ("release_safety_self_test_" + $Timestamp)
    Move-ToBackupIfExists -TargetPath $selfTestRoot
    New-Item -ItemType Directory -Path $selfTestRoot -Force | Out-Null
    $sourceConfigPath = Join-Path $selfTestRoot "source_config.json"
    $releaseDir = Join-Path $selfTestRoot "release"
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    Write-Utf8Text -Path $sourceConfigPath -Content @'
{
  "credentials": {
    "web_client": {
      "username": "self_test_user",
      "password": "self_test_password"
    },
    "jd_service": {
      "username": "self_test_user",
      "password": "self_test_password"
    }
  }
}
'@
    Export-SanitizedReleaseConfig -SourcePath $sourceConfigPath -DestinationPath (Join-Path $releaseDir "config.json")
    Assert-NoSensitiveReleaseDirectoryContent -ReleaseDir $releaseDir
    Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath (Join-Path $selfTestRoot "release.zip") -Force
    Assert-NoSensitiveReleaseZipContent -ZipPath (Join-Path $selfTestRoot "release.zip")

    $badDir = Join-Path $releaseDir "runtime\browser_profiles\chrome\Default"
    New-Item -ItemType Directory -Path $badDir -Force | Out-Null
    Write-Utf8Text -Path (Join-Path $badDir "Login Data") -Content "self_test"
    $caughtForbiddenPath = $false
    try {
        Assert-NoSensitiveReleaseDirectoryContent -ReleaseDir $releaseDir
    } catch {
        if ($_.Exception.Message -like "*敏感文件*") {
            $caughtForbiddenPath = $true
        } else {
            throw
        }
    }
    if (-not $caughtForbiddenPath) {
        throw "发布安全自检失败：敏感浏览器文件未被拦截"
    }
    Move-ToBackupIfExists -TargetPath $selfTestRoot
    Write-ReleaseLog "自检" "发布安全规则通过"
}
