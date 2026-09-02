param(
    [string]$Mode = "",
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "last_startup.log"
$RunLogFile = $LogFile

function Write-RelayLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    Add-RelayLogLine -Line $line
}

function Add-RelayLogLine {
    param([string]$Line)
    for ($i = 0; $i -lt 5; $i++) {
        try {
            Add-Content -LiteralPath $RunLogFile -Encoding UTF8 -Value $Line -ErrorAction Stop
            return
        } catch {
            Start-Sleep -Milliseconds 80
        }
    }
}

function Wait-BeforeExit {
    param([bool]$NoPause)
    if (-not $NoPause) {
        Write-Host ""
        Read-Host "Press Enter to close"
    }
}

function Test-CheckMode {
    param([string[]]$Values)
    foreach ($value in $Values) {
        if ([string]::Equals($value, "--check", [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
        if ([string]::Equals($value, "check", [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Invoke-LoggedProcess {
    param(
        [string]$Action,
        [string]$Executable,
        [string[]]$Arguments
    )
    # 该函数用于执行关键启动命令并同步记录输出，失败时直接中断启动暴露根因。
    Write-RelayLog "${Action}: $Executable $($Arguments -join ' ')"
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Executable @Arguments 2>&1 | ForEach-Object {
            $text = $_.ToString()
            Write-Host $text
            Add-RelayLogLine -Line $text
        }
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    if ($exitCode -ne 0) {
        throw "${Action}失败，退出码：$exitCode"
    }
}

function Test-PlaywrightReady {
    param([string]$PythonExecutable)
    # 该函数用于确认 Playwright 包已经安装，真正导入验证交给 app_entry.py 的自检模式。
    $checkArguments = @("-X", "utf8", "-m", "pip", "show", "playwright")
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $PythonExecutable @checkArguments 2>&1 | ForEach-Object {
            Add-RelayLogLine -Line $_.ToString()
        }
        return $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Initialize-PythonEnvironment {
    param(
        [string]$BasePythonExecutable,
        [string[]]$BasePythonArgumentsPrefix,
        [string]$ProjectRoot
    )
    # 该函数用于把项目依赖固定在本地隔离环境中，避免全局 Python 缺包或污染启动结果。
    Write-RelayLog "Project root for Python env: $ProjectRoot"
    $venvDir = Join-Path $ProjectRoot "runtime\python_env"
    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    $requirementsFile = Join-Path $ProjectRoot "requirements.txt"

    if (-not (Test-Path -LiteralPath $requirementsFile)) {
        throw "未找到依赖清单：$requirementsFile"
    }

    if (-not (Test-Path -LiteralPath $venvPython)) {
        $runtimeDir = Join-Path $ProjectRoot "runtime"
        if (-not (Test-Path -LiteralPath $runtimeDir)) {
            New-Item -ItemType Directory -Path $runtimeDir | Out-Null
        }
        Invoke-LoggedProcess -Action "创建本地Python环境" -Executable $BasePythonExecutable -Arguments (@() + $BasePythonArgumentsPrefix + @("-m", "venv", $venvDir))
    }

    Write-RelayLog "Python env: $venvPython"

    if (-not (Test-PlaywrightReady -PythonExecutable $venvPython)) {
        Invoke-LoggedProcess -Action "安装Python依赖" -Executable $venvPython -Arguments @("-X", "utf8", "-m", "pip", "install", "-r", $requirementsFile)
    }

    if (-not (Test-PlaywrightReady -PythonExecutable $venvPython)) {
        throw "Playwright 依赖安装后仍不可用，请查看上方 pip 输出"
    }

    return $venvPython
}

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    if (-not (Test-Path -LiteralPath $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir | Out-Null
    }
    $RunLogFile = Join-Path $LogDir ("startup_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss_fff"))
    try {
        Set-Content -LiteralPath $RunLogFile -Encoding UTF8 -Value ("[{0}] ========== START ==========" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -ErrorAction Stop
        Set-Content -LiteralPath $LogFile -Encoding UTF8 -Value $RunLogFile -ErrorAction Stop
    } catch {
        Add-RelayLogLine -Line ("[{0}] ========== START ==========" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
    }

    Set-Location -LiteralPath $Root
    $env:PYTHONDONTWRITEBYTECODE = "1"
    $env:PYTHONIOENCODING = "utf-8"
    $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
    $modeValues = @($Mode) + @($args)
    $isCheck = Test-CheckMode -Values $modeValues

    Write-RelayLog "Workdir: $Root"
    Write-RelayLog "Hint: after login, press F8 to start; press F8 to pause/resume; press F9 to stop."

    $pythonArgsPrefix = @()
    $pythonExe = ""
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($null -ne $py) {
        $pythonExe = $py.Source
        $pythonArgsPrefix = @("-3")
    } else {
        $python = Get-Command python -ErrorAction SilentlyContinue
        if ($null -ne $python) {
            $pythonExe = $python.Source
        }
    }

    if ([string]::IsNullOrWhiteSpace($pythonExe)) {
        throw "Python not found. Please install Python or add it to PATH."
    }

    Write-RelayLog "Base Python path: $pythonExe"
    $pythonExe = Initialize-PythonEnvironment -BasePythonExecutable $pythonExe -BasePythonArgumentsPrefix $pythonArgsPrefix -ProjectRoot $Root
    $pythonArgsPrefix = @()
    Write-RelayLog "Python path: $pythonExe"

    if ($isCheck) {
        Write-RelayLog "Check mode: read config only; no real automation."
        $args = @() + $pythonArgsPrefix + @("-X", "utf8", (Join-Path $Root "app_entry.py"), "check")
    } else {
        Write-RelayLog "Start control panel: panel.py"
        $args = @() + $pythonArgsPrefix + @("-X", "utf8", (Join-Path $Root "panel.py"))
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $pythonExe @args 2>&1 | ForEach-Object {
            $text = $_.ToString()
            Write-Host $text
            Add-RelayLogLine -Line $text
        }
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    Write-RelayLog "Exit code: $exitCode"

    if ($exitCode -ne 0) {
        throw "Program exited with non-zero code: $exitCode"
    }

    Write-RelayLog "Program exited normally."
    exit 0
} catch {
    Write-RelayLog "ERROR: $($_.Exception.Message)"
    if ($_.InvocationInfo -and $_.InvocationInfo.PositionMessage) {
        Write-RelayLog "ERROR_POSITION: $($_.InvocationInfo.PositionMessage)"
    }
    if ($_.ScriptStackTrace) {
        Write-RelayLog "ERROR_STACK: $($_.ScriptStackTrace)"
    }
    Write-Host ""
    Write-Host "Startup failed. Log file: $RunLogFile"
    if (Test-Path -LiteralPath $RunLogFile) {
        Write-Host ""
        Write-Host "===== last_startup.log ====="
        Get-Content -LiteralPath $RunLogFile -Encoding UTF8
        Write-Host "========================"
    }
    Wait-BeforeExit -NoPause:($NoPause -or (Test-CheckMode -Values (@($Mode) + @($args))))
    exit 1
}
