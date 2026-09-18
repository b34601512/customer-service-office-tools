// 本文件只提供统一日志格式：终端可读一行 + 文件带时间戳，不含业务判断。
const fs = require("fs");
const path = require("path");
const appConfig = require("../config/appConfig");
const { ensureDir } = require("./fileSystem");

// 终端界面（方向键菜单）占屏时把控制台输出暂时关掉，日志照旧落盘；界面退出后恢复。
// 这不是"重试开关"，只是控制台显示层，业务行为不受影响。
let consoleEnabled = true;

function setConsoleEnabled(enabled) {
  consoleEnabled = enabled !== false;
}

function log(stage, scope, action, detail = "") {
  const line = `[${new Date().toISOString()}] ${stage} | ${scope} | ${action}${detail ? ` | ${detail}` : ""}`;
  if (consoleEnabled) console.log(line);
  try {
    ensureDir(appConfig.logDir);
    fs.appendFileSync(path.join(appConfig.logDir, "run.log"), `${line}\n`, "utf8");
  } catch (error) {
    // 日志写盘失败不能影响主流程。
  }
}

module.exports = { log, setConsoleEnabled };
