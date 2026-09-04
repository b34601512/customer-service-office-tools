function Invoke-RegExe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    # 统一调用 reg.exe，并在失败时直接抛出中文异常，避免注册表错误被吞掉。
    $output = & reg.exe @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $errorText = ($output | Out-String).Trim()
        throw "reg.exe 执行失败：$errorText"
    }

    $output
}
