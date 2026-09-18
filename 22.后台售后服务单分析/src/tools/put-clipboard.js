#!/usr/bin/env node
// 把文件内容直接送进 Windows 剪贴板，让用户「Ctrl+V」就能粘贴，不必自己开文件复制。
// 场景：金山 AirScript 这类必须由用户手动粘贴的地方（用户 2026-09-18 明确要求这样配合）。
//
// 用法：node src/tools/put-clipboard.js <文件>        # 默认按 UTF-8 读
//       node src/tools/put-clipboard.js <文件> --show # 送完回读校验并打印前后 60 字
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { projectPath } = require("../config/stores");

function runPowerShell(command) {
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
}

function main() {
  const target = process.argv[2];
  const showVerification = process.argv.includes("--show");
  if (!target) {
    console.error("用法：node src/tools/put-clipboard.js <文件> [--show]");
    process.exit(2);
  }
  const filePath = path.isAbsolute(target) ? target : projectPath(target);
  if (!fs.existsSync(filePath)) {
    console.error(`文件不存在：${filePath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(filePath, "utf8");
  // PowerShell 里路径用单引号包裹，单引号本身要写两遍；文本用 ReadAllText 明确按 UTF-8 读，避免中文注释乱码。
  const escapedPath = filePath.replace(/'/g, "''");
  runPowerShell(`$t = [IO.File]::ReadAllText('${escapedPath}', [Text.Encoding]::UTF8); Set-Clipboard -Value $t; Write-Output $t.Length`);
  const expectedLength = text.length;
  const actualLength = Number(runPowerShell("(Get-Clipboard -Raw).Length").trim());
  const sameLength = Math.abs(actualLength - expectedLength) <= 2; // 剪贴板可能多一个尾随换行
  console.log(`  已送进剪贴板：${path.relative(projectPath(), filePath)}（${expectedLength} 字，回读 ${actualLength} 字，${sameLength ? "一致 ✓" : "长度不一致 ✗ 请重试"}）`);
  if (showVerification) {
    const clipped = runPowerShell("Get-Clipboard -Raw");
    console.log(`  剪贴板开头：${JSON.stringify(clipped.slice(0, 60))}`);
    console.log(`  剪贴板结尾：${JSON.stringify(clipped.slice(-60))}`);
  }
  if (!sameLength) process.exit(1);
}

main();
