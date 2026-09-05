param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot '分享输出' }
$exportRoot = [IO.Path]::GetFullPath($OutputDirectory)
$privateRoot = Join-Path $projectRoot '德达医疗公司专属资料'
if ($exportRoot.Equals($privateRoot,[StringComparison]::OrdinalIgnoreCase) -or $exportRoot.StartsWith($privateRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
    throw '分享输出不得放入公司专属目录'
}
# Only this allowlist is eligible for export. Never enumerate the entire project into a zip.
$allowlist = @(
    'AGENTS.md',
    'README.md',
    'AI工作手册.md',
    '模板/公司接入与拍板.md',
    '通用经验/在线文档完整读取.md',
    '工具/导出通用分享包.ps1'
)
$sources = @()
foreach ($relative in $allowlist) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (-not $absolute.StartsWith($projectRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw '白名单越界' }
    $item = Get-Item -LiteralPath $absolute
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '白名单仅允许普通文件' }
    $cursor = $item.Directory
    while ($cursor.FullName -ne $projectRoot) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '目录链接不能导出' }
        $cursor = $cursor.Parent
        if (-not $cursor) { throw '无法确定项目根' }
    }
    $content = [IO.File]::ReadAllText($absolute)
    # Conservative guard only, not a full security audit; never print a matched secret.
    if ($content -match '(?i)(?:tanyu-agent-account\s*[=:]\s*[^<\s;]{8,}|Bearer\s+[A-Za-z0-9._-]{16,}|sk-[A-Za-z0-9_-]{20,}|C:[/\\]Users[/\\](?!<)[A-Za-z0-9])') {
        throw "疑似凭据或本机路径，停止导出：$relative"
    }
    $sources += [pscustomobject]@{ relative=$relative; absolute=$absolute; sha256=(Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash }
}
New-Item -ItemType Directory -Path $exportRoot -Force | Out-Null
$zipFile = Join-Path $exportRoot ('客服主管AI通用指南-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.zip')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($zipFile,[IO.FileMode]::CreateNew)
try {
    $zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
    try {
        foreach ($source in $sources) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$source.absolute,$source.relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($zipFile)
try {
    if ($archive.Entries.Count -ne $sources.Count) { throw '归档数量不符，勿分享' }
    foreach ($source in $sources) {
        $entry = $archive.GetEntry($source.relative)
        if (-not $entry) { throw '归档条目缺失，勿分享' }
        $entryStream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($sha.ComputeHash($entryStream)).Replace('-','') }
        finally { $entryStream.Dispose(); $sha.Dispose() }
        if ($actual -ne $source.sha256) { throw '归档哈希不符，勿分享' }
    }
} finally { $archive.Dispose() }
Write-Output ('完成：' + $zipFile)
Write-Output ('已核验白名单文件：' + $sources.Count + '；未包含公司资料。正式外发前请打开ZIP核对。')
