function Write-StepLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$MainAction,

        [Parameter(Mandatory = $true)]
        [string]$ModuleName,

        [Parameter(Mandatory = $true)]
        [string]$SubAction
    )

    # 统一打印终端日志，确保每一步都能定位到调用位置。
    $callerFrame = Get-PSCallStack | Select-Object -Skip 1 -First 1
    $fileName = if ($null -ne $callerFrame -and $callerFrame.ScriptName) {
        Split-Path -Leaf $callerFrame.ScriptName
    }
    else {
        '控制台'
    }
    $lineNumber = if ($null -ne $callerFrame -and $callerFrame.ScriptLineNumber) {
        $callerFrame.ScriptLineNumber
    }
    else {
        0
    }
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    $message = "[{0}][{1}:{2}][主线:{3}][{4}][{5}]" -f $timestamp, $fileName, $lineNumber, $MainAction, $ModuleName, $SubAction
    Write-Host $message
}
