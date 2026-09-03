// 本文件只提供统一日志格式：终端可读一行 + 文件带时间戳，不含业务判断。
const fs = require("fs");
const path = require("path");
const appConfig = require("../config/appConfig");
const { ensureDir } = require("./fileSystem");

function log(stage, scope, action, detail = "") {
  const line = `[${new Date().toISOString()}] ${stage} | ${scope} | ${action}${detail ? ` | ${detail}` : ""}`;
  console.log(line);
  try {
    ensureDir(appConfig.logDir);
    fs.appendFileSync(path.join(appConfig.logDir, "run.log"), `${line}\n`, "utf8");
  } catch (error) {
    // 日志写盘失败不能影响主流程。
  }
}

module.exports = { log };
