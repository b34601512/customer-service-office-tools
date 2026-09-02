param(
    [string]$Version = "",
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ReleaseScriptRoot = Join-Path (Join-Path $PSScriptRoot "scripts") "release"
. (Join-Path $ReleaseScriptRoot "logging.ps1")
. (Join-Path $ReleaseScriptRoot "utf8-file.ps1")
. (Join-Path $ReleaseScriptRoot "python-tools.ps1")
. (Join-Path $ReleaseScriptRoot "versioning.ps1")
. (Join-Path $ReleaseScriptRoot "backup.ps1")
. (Join-Path $ReleaseScriptRoot "json-config.ps1")
. (Join-Path $ReleaseScriptRoot "release-safety.ps1")
. (Join-Path $ReleaseScriptRoot "run-release-build.ps1")

Invoke-ReleaseBuild -ProjectRoot $PSScriptRoot -Version $Version -SelfTest:$SelfTest
