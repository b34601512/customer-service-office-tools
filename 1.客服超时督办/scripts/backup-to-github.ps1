Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Path $PSScriptRoot -Parent
$remoteUrl = "https://github.com/b34601512/customer-timeout-supervisor.git"

function Write-StepLog {
  param(
    [string]$Stage,
    [string]$Action,
    [string]$Message
  )

  # 这里统一输出备份脚本日志，后续定位 Git 推送问题可以直接看终端。
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
  $stack = Get-PSCallStack
  $lineNumber = if ($stack.Count -gt 1) { $stack[1].ScriptLineNumber } else { 0 }
  $scriptName = Split-Path -Leaf $PSCommandPath
  Write-Host "[$timestamp][scripts\${scriptName}:${lineNumber}][主线:${Stage}][Git仓库备份][${Action}] $Message"
}

function Ensure-CommandAvailable {
  param([string]$CommandName)

  # 这里先硬校验 git 是否可用，避免脚本跑到一半才发现机器上没有 git。
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "当前机器未安装 $CommandName，无法执行 GitHub 备份。"
  }
}

function Invoke-GitCommand {
  param(
    [string[]]$CommandArgs,
    [string]$FailureMessage
  )

  # 这里统一硬校验每一次 git 调用，避免前面失败了，脚本却继续往下误报成功。
  & git -C $projectRoot @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "${FailureMessage}，退出码=$LASTEXITCODE"
  }
}

function Remove-StaleCommitEditMessage {
  # 这里在提交前清理残留的 COMMIT_EDITMSG，避免上一次异常中断留下的文件把本次提交卡死。
  $commitEditMessagePath = Join-Path $projectRoot ".git\\COMMIT_EDITMSG"
  if (-not (Test-Path $commitEditMessagePath)) {
    return
  }

  try {
    Remove-Item $commitEditMessagePath -Force
  } catch {
    throw "清理残留提交草稿失败：$commitEditMessagePath，原因=$($_.Exception.Message)"
  }

  Write-StepLog "执行" "清理提交草稿" "已删除残留的 COMMIT_EDITMSG"
}

function Ensure-RemoteConfigured {
  # 这里先强制要求单独配置主管端仓库地址，避免误把新项目推回客服端仓库。
  if ([string]::IsNullOrWhiteSpace($remoteUrl)) {
    throw "当前脚本还未配置主管端 GitHub 仓库地址，请先打开 scripts\\backup-to-github.ps1 填写 remoteUrl。"
  }
}

function Ensure-GitRepo {
  # 这里确保项目根目录本身就是正式 Git 仓库，而不是临时导出快照。
  if (-not (Test-Path (Join-Path $projectRoot ".git"))) {
    throw "项目根目录还不是 Git 仓库，请先完成仓库初始化。"
  }

  $remoteNames = (& git -C $projectRoot remote) | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if ($remoteNames -contains "origin") {
    Invoke-GitCommand -CommandArgs @("remote", "set-url", "origin", $remoteUrl) -FailureMessage "更新 origin 远程地址失败"
  } else {
    Invoke-GitCommand -CommandArgs @("remote", "add", "origin", $remoteUrl) -FailureMessage "添加 origin 远程地址失败"
  }
}

function Commit-And-Push {
  # 这里统一执行 add/commit/push，没有变化就直接结束，不制造空提交。
  Write-StepLog "执行" "提交备份" "开始把当前项目提交并推送到 GitHub"
  Invoke-GitCommand -CommandArgs @("add", "-A") -FailureMessage "git add 执行失败"

  & git -C $projectRoot diff --cached --quiet --exit-code
  if ($LASTEXITCODE -eq 0) {
    Write-StepLog "完成" "无需提交" "当前没有新变化，本轮不创建提交"
    return
  }

  if ($LASTEXITCODE -ne 1) {
    throw "git diff --cached 执行失败，退出码=$LASTEXITCODE"
  }

  $commitMessage = "backup: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  Remove-StaleCommitEditMessage
  Invoke-GitCommand -CommandArgs @("commit", "-m", $commitMessage) -FailureMessage "git commit 失败"
  Invoke-GitCommand -CommandArgs @("push", "-u", "origin", "main") -FailureMessage "git push 失败"

  Write-StepLog "完成" "推送成功" "项目根目录已作为正式仓库推送到 GitHub"
}

try {
  Write-StepLog "启动" "开始执行" "开始备份主管端项目根目录 Git 仓库"
  Ensure-CommandAvailable -CommandName "git"
  Ensure-RemoteConfigured
  Ensure-GitRepo
  Commit-And-Push
  exit 0
} catch {
  Write-StepLog "失败" "备份中断" $_.Exception.Message
  exit 1
}
