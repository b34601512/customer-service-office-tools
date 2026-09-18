// 本文件只负责把动作写进日志（控制台 + runtime/logs/run.log），不含业务判断。
const fs = require("fs");
const path = require("path");
const { projectPath } = require("../config/stores");

const LOG_PATH = projectPath("runtime", "logs", "run.log");

function timestamp() {
  const now = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

// 用法：log("浏览器", "会话", "已连接受控Chrome", "port=9421")
function log(...parts) {
  const line = `[${timestamp()}] ${parts.filter(Boolean).join(" | ")}`;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${line}\n`, "utf8");
  } catch (error) {
    // 日志写失败不影响主流程
  }
  console.log(`  ${line}`);
  return line;
}

module.exports = { log, LOG_PATH };
