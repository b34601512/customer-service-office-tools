function Publish-CopyQuotedPathApp {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    # 使用系统自带编译器生成无控制台剪贴板程序，彻底绕开脚本宿主黑窗和首次点击时序问题。
    $sourceFilePath = Join-Path -Path $ProjectRoot -ChildPath 'app\CopyQuotedPathApp\Program.cs'
    if (-not (Test-Path -LiteralPath $sourceFilePath)) {
        throw "源码文件不存在：$sourceFilePath"
    }

    $outputDirectoryPath = Join-Path -Path $ProjectRoot -ChildPath 'dist'
    if (-not (Test-Path -LiteralPath $outputDirectoryPath)) {
        New-Item -ItemType Directory -Path $outputDirectoryPath -Force | Out-Null
    }

    $compilerPathCandidates = @(
        'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
        'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
    )
    $compilerPath = $compilerPathCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($compilerPath)) {
        throw '找不到系统自带的 csc.exe 编译器。'
    }

    $applicationPath = Join-Path -Path $outputDirectoryPath -ChildPath 'CopyQuotedPath.exe'
    $compilerArguments = @(
        '/nologo',
        '/target:winexe',
        '/optimize+',
        ('/out:' + $applicationPath),
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        $sourceFilePath
    )

    Write-StepLog -MainAction '安装' -ModuleName '发布程序' -SubAction "开始编译：$sourceFilePath"
    $buildOutput = & $compilerPath @compilerArguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "编译复制程序失败：$($buildOutput | Out-String)"
    }

    if (-not (Test-Path -LiteralPath $applicationPath)) {
        throw "编译结果不存在：$applicationPath"
    }

    Write-StepLog -MainAction '安装' -ModuleName '发布程序' -SubAction "编译完成：$applicationPath"
    $applicationPath
}
