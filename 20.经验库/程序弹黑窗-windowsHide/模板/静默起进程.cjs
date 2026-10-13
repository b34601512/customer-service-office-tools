// 静默起一个后台进程：不弹黑窗、stdout/stderr 进日志文件——复制即用（Node）
// 要点：spawn 带 windowsHide: true + stdio 收口到文件 + unref 放生。
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * 静默起进程（不弹窗）
 * @param {string} 命令 可执行文件（如 "python"、"node"）
 * @param {string[]} 参数
 * @param {{cwd?: string, 日志目录?: string}} [选项]
 * @returns {import("node:child_process").ChildProcess}
 */
function 静默起(命令, 参数 = [], 选项 = {}) {
  const 日志目录 = 选项.日志目录 || path.join(process.cwd(), "logs");
  fs.mkdirSync(日志目录, { recursive: true });
  const 名 = path.basename(命令).replace(/\.exe$/i, "");
  const 出 = fs.openSync(path.join(日志目录, 名 + ".out.log"), "a");
  const 错 = fs.openSync(path.join(日志目录, 名 + ".err.log"), "a");
  const 子 = spawn(命令, 参数, {
    cwd: 选项.cwd || process.cwd(),
    detached: true,
    windowsHide: true, // ★ 不弹可见黑窗
    stdio: ["ignore", 出, 错], // 输出进日志，不顺端口漏
  });
  子.unref(); // 父进程退出不带走它；要停它请另记 PID 单独停
  return 子;
}

// 自测：起一个 1 秒的小命令，屏幕上不应有窗；日志落在 logs\cmd.out.log
if (require.main === module) {
  静默起("cmd", ["/c", "echo hidden-child-ok & ping -n 2 127.0.0.1 >nul"]);
  setTimeout(() => {
    const 文件 = path.join(process.cwd(), "logs", "cmd.out.log");
    const 文 = fs.readFileSync(文件, "utf8");
    const 行 = 文.split(/\r?\n/).filter(Boolean).pop() || "(空)";
    console.log("已静默起进程（屏幕上应无任何窗）。日志最后一行：" + 行);
  }, 2500);
}

module.exports = { 静默起 };
