function Set-ClipboardText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    # 解决资源管理器右键菜单刚关闭时的剪贴板竞争，确保首次点击也能稳定写入。
    Add-Type -AssemblyName System.Windows.Forms

    $attemptCount = 0
    $deadline = (Get-Date).AddMilliseconds(1200)
    while ($true) {
        $attemptCount += 1
        try {
            [System.Windows.Forms.Clipboard]::SetText($Text)
            Write-StepLog -MainAction '执行' -ModuleName '剪贴板' -SubAction "第 $attemptCount 次写入成功"
            return
        }
        catch {
            if ((Get-Date) -ge $deadline) {
                throw "剪贴板在 1200 毫秒内一直被占用，无法写入：$($_.Exception.Message)"
            }

            Write-StepLog -MainAction '执行' -ModuleName '剪贴板' -SubAction "第 $attemptCount 次写入失败，等待后重试"
            Start-Sleep -Milliseconds 60
        }
    }
}
