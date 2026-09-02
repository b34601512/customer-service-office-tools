const fs = require("fs");
const path = require("path");
const { broadcastLog } = require("./logHub");

const projectRoot = path.resolve(__dirname, "..", "..");
const currentLogFilePath = path.join(projectRoot, "runtime", "current-run.log");
const currentLogResetEnvName = "CUSTOMER_SUPERVISOR_CURRENT_RUN_LOG_RESET";

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
  // 这里从调用栈里提取真实文件和行号，保证日志能直接回溯到代码位置。
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
      file: path.basename(match[1]),
      line: match[2]
    };
  }

  return {
    file: "unknown",
    line: "0"
  };
}

function normalizeMainAction(mainAction) {
  // 这里统一兼容旧调用方式，避免把「主线:」前缀打印成两层重复文本。
  const normalizedMainAction = String(mainAction || "").trim();
  if (!normalizedMainAction) {
    return "主线:未命名";
  }

  return normalizedMainAction.startsWith("主线:")
    ? normalizedMainAction
    : `主线:${normalizedMainAction}`;
}

function buildPrefix(mainAction, moduleName, subAction) {
  // 这里统一拼接结构化日志前缀，确保所有模块都遵守同一套中文日志格式。
  const caller = extractCaller();
  const time = formatTime(new Date());
  const normalizedModuleName = String(moduleName || "未命名模块").trim() || "未命名模块";
  const normalizedSubAction = String(subAction || "").trim();
  const subActionSegment = normalizedSubAction ? `[${normalizedSubAction}]` : "";
  return `[${time}][${caller.file}:${caller.line}][${normalizeMainAction(mainAction)}][${normalizedModuleName}]${subActionSegment}`;
}

function appendLocalLogLine(line) {
  // 这里把本次运行日志落到固定文件，避免窗口异常关闭后现场证据一起丢失。
  try {
    fs.mkdirSync(path.dirname(currentLogFilePath), { recursive: true });
    fs.appendFileSync(currentLogFilePath, `${line}\n`, "utf8");
  } catch (error) {
    console.error(`[${formatTime(new Date())}][logger.js:0][主线:失败][日志系统][写入本地日志] ${error.message}`);
  }
}

function resetCurrentLogFile() {
  // 这里每次从启动中心进入时清空旧日志，只保留本次运行，避免长期堆积无效信息。
  fs.mkdirSync(path.dirname(currentLogFilePath), { recursive: true });
  fs.writeFileSync(currentLogFilePath, "", "utf8");
}

function resetCurrentLogFileOnce() {
  // 这里用进程环境标记同一次启动链路已清空日志，避免控制台再拉后台任务时误删当前现场。
  if (process.env[currentLogResetEnvName] === "1") {
    return false;
  }

  resetCurrentLogFile();
  process.env[currentLogResetEnvName] = "1";
  return true;
}

function emitLine(line, isError = false) {
  // 这里统一输出并广播日志，保证终端与网页控制台看到一致的文本内容。
  if (isError) {
    console.error(line);
  } else {
    console.log(line);
  }
  appendLocalLogLine(line);
  broadcastLog(line);
}

function log(mainAction, moduleName, subAction, message) {
  const hasMessage = message !== undefined && message !== null && String(message) !== "";
  const messageSegment = hasMessage ? ` ${String(message)}` : "";
  emitLine(`${buildPrefix(mainAction, moduleName, subAction)}${messageSegment}`);
}

function logError(mainAction, moduleName, subAction, error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  emitLine(`${buildPrefix(mainAction, moduleName, subAction)} ${message}`, true);
}

module.exports = {
  appendLocalLogLine,
  currentLogFilePath,
  currentLogResetEnvName,
  log,
  logError,
  resetCurrentLogFile,
  resetCurrentLogFileOnce
};
