const path = require("path");
const fs = require("fs");
const appConfig = require("../config/appConfig");
const LOG_LIMIT = 300;
const ANSI_LOG_COLOR_CODES = Object.freeze({
  reset: "\u001b[0m",
  green: "\u001b[32m",
  red: "\u001b[31m"
});
const SUCCESS_MAIN_ACTION = "主线:完成";
const FAILURE_MAIN_ACTIONS = new Set(["主线:失败", "主线:错误"]);
const recentLogs = [];
let nextLogId = 1;

function formatTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function extractCaller() {
  // 这里通过调用栈反查当前日志调用点，保证终端日志能直接定位到文件和行号。
  const stack = new Error().stack || "";
  const lines = stack.split("\n").slice(2);

  for (const line of lines) {
    if (line.includes("logger.js")) {
      continue;
    }

    const match = line.match(/\(?([A-Z]:\\.+?):(\d+):(\d+)\)?$/i);
    if (!match) {
      continue;
    }

    return {
      file: path.relative(appConfig.projectRoot, match[1]).replace(/\\/g, "/"),
      line: match[2]
    };
  }

  return {
    file: "unknown",
    line: "0"
  };
}

function rememberLog(entry) {
  recentLogs.unshift(entry);
  if (recentLogs.length > LOG_LIMIT) {
    recentLogs.length = LOG_LIMIT;
  }
}

function getRuntimeLogPath() {
  // 这里只读取启动器传入的日志路径，避免测试和命令行工具无意污染生产运行日志。
  return String(process.env.CUSTOMER_PERFORMANCE_LOG_PATH || "").trim();
}

function appendRuntimeLog(entry) {
  // 这里由 Node 直接写 UTF-8 日志，避免 PowerShell 转发控制台输出时把中文写成乱码。
  const logPath = getRuntimeLogPath();
  if (!logPath) {
    return;
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${entry.text}\n`, "utf8");
}

function shouldSuppressConsoleLog() {
  // 外部启动脚本可以要求 Node 只写文件日志，避免同一行日志重复写回控制台管道。
  return String(process.env.CUSTOMER_PERFORMANCE_SUPPRESS_CONSOLE_LOG || "").trim() === "1";
}

function resolveLogColorCode(logEntry) {
  if (logEntry?.level === "error" || FAILURE_MAIN_ACTIONS.has(logEntry?.mainAction)) {
    return ANSI_LOG_COLOR_CODES.red;
  }
  if (logEntry?.level === "success" || logEntry?.mainAction === SUCCESS_MAIN_ACTION) {
    return ANSI_LOG_COLOR_CODES.green;
  }
  return "";
}

function shouldUseConsoleLogColor() {
  return Boolean(process.stdout?.isTTY) && !process.env.NO_COLOR;
}

function formatConsoleLogForDisplay(logEntry, colorEnabled = shouldUseConsoleLogColor()) {
  const colorCode = resolveLogColorCode(logEntry);
  if (!colorEnabled || !colorCode) {
    return logEntry.text;
  }
  return `${colorCode}${logEntry.text}${ANSI_LOG_COLOR_CODES.reset}`;
}

function buildLogEntry(level, mainAction, moduleName, subAction, message) {
  const caller = extractCaller();
  const timeText = formatTime(new Date());
  const prefix = `[${timeText}][${caller.file}:${caller.line}][${mainAction}][${moduleName}][${subAction}]`;
  const normalizedMessage = String(message ?? "").replace(/\r\n/g, "\n");
  const formattedText = normalizedMessage
    .split("\n")
    .map((line) => `${prefix} ${line}`)
    .join("\n");
  return {
    id: nextLogId,
    level,
    timeText,
    file: caller.file,
    line: caller.line,
    mainAction,
    moduleName,
    subAction,
    message,
    text: formattedText
  };
}

function emitLog(level, mainAction, moduleName, subAction, rawMessage) {
  const message = String(rawMessage ?? "");
  const entry = buildLogEntry(level, mainAction, moduleName, subAction, message);
  nextLogId += 1;
  rememberLog(entry);
  appendRuntimeLog(entry);

  if (shouldSuppressConsoleLog()) {
    return entry;
  }

  // 运行期日志文件保持纯文本，终端显示才按结果状态加颜色，避免颜色控制字符污染日志文件。
  console.log(formatConsoleLogForDisplay(entry));
  return entry;
}

function log(mainAction, moduleName, subAction, message) {
  return emitLog("info", mainAction, moduleName, subAction, message);
}

function logError(mainAction, moduleName, subAction, error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  return emitLog("error", mainAction, moduleName, subAction, message);
}

function getRecentLogs(limit = LOG_LIMIT) {
  // 这里返回日志副本，避免控制台接口把内存中的原始日志对象直接暴露出去。
  const safeLimit = Math.max(1, Math.min(Number(limit) || LOG_LIMIT, LOG_LIMIT));
  return recentLogs.slice(0, safeLimit).map((entry) => ({ ...entry }));
}

module.exports = {
  log,
  logError,
  getRecentLogs,
  resolveLogColorCode,
  formatConsoleLogForDisplay
};
