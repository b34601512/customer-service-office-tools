#!/usr/bin/env pwsh
# 该脚本文件由发布入口加载；每个文件只负责发布流程中的一个职责。

function Get-PythonCommandSpec {
    # 该函数用于选择当前机器可用的 Python，避免只依赖缺失率较高的 Windows py 启动器。
    $localPythonPath = Join-Path $Root "runtime\python_env\Scripts\python.exe"
    if (Test-Path -LiteralPath $localPythonPath) {
        return [pscustomobject]@{
            Command = $localPythonPath
            PrefixArgs = @()
            Display = $localPythonPath
        }
    }
    $pyLauncher = Get-Command "py" -ErrorAction SilentlyContinue
    if ($null -ne $pyLauncher) {
        return [pscustomobject]@{
            Command = "py"
            PrefixArgs = @("-3")
            Display = "py -3"
        }
    }
    $pythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        return [pscustomobject]@{
            Command = "python"
            PrefixArgs = @()
            Display = "python"
        }
    }
    throw "Python 环境检查失败：未找到 runtime\python_env\Scripts\python.exe、py 或 python，无法继续打包"
}

function Test-PythonModule {
    # 该函数用于用当前选定的 Python 验证模块是否存在，避免到打包中途才暴露缺依赖。
    param(
        [object]$PythonSpec,
        [string]$ModuleName
    )
    $pythonArgs = @($PythonSpec.PrefixArgs) + @("-c", "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('$ModuleName') else 1)")
    & $PythonSpec.Command @pythonArgs
    return $LASTEXITCODE -eq 0
}

function Ensure-PythonPackage {
    # 该函数用于自动补齐打包必需依赖，让一键打包脚本在新环境里也能直接运行。
    param(
        [object]$PythonSpec,
        [string]$ModuleName,
        [string]$PackageName
    )
    if (Test-PythonModule -PythonSpec $PythonSpec -ModuleName $ModuleName) {
        Write-ReleaseLog "依赖" "Python模块已存在" "module='$ModuleName'"
        return
    }
    Write-ReleaseLog "依赖" "安装Python包" "$($PythonSpec.Display) -m pip install $PackageName"
    $pipArgs = @($PythonSpec.PrefixArgs) + @("-m", "pip", "install", $PackageName)
    & $PythonSpec.Command @pipArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Python 依赖安装失败：$PackageName，退出码：$LASTEXITCODE"
    }
    if (-not (Test-PythonModule -PythonSpec $PythonSpec -ModuleName $ModuleName)) {
        throw "Python 依赖安装后仍不可用：$ModuleName"
    }
}

function Get-PyInstallerCommandSpec {
    # 该函数用于复用本机已有 PyInstaller，避免网络异常时一键打包被 pip 安装步骤卡死。
    param([object]$DefaultPythonSpec)
    if (Test-PythonModule -PythonSpec $DefaultPythonSpec -ModuleName "PyInstaller") {
        return $DefaultPythonSpec
    }
    $candidateSpecs = @()
    $pyLauncher = Get-Command "py" -ErrorAction SilentlyContinue
    if ($null -ne $pyLauncher) {
        $candidateSpecs += [pscustomobject]@{
            Command = "py"
            PrefixArgs = @("-3")
            Display = "py -3"
        }
    }
    $pythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        $candidateSpecs += [pscustomobject]@{
            Command = "python"
            PrefixArgs = @()
            Display = "python"
        }
    }
    foreach ($candidateSpec in $candidateSpecs) {
        if (Test-PythonModule -PythonSpec $candidateSpec -ModuleName "PyInstaller") {
            Write-ReleaseLog "依赖" "复用已有PyInstaller" "$($candidateSpec.Display) -m PyInstaller"
            return $candidateSpec
        }
    }
    Ensure-PythonPackage -PythonSpec $DefaultPythonSpec -ModuleName "PyInstaller" -PackageName "pyinstaller>=6.7,<7"
    return $DefaultPythonSpec
}
