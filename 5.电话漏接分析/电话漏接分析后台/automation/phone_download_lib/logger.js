const path = require("path");

function callerLocation() {
  // 从调用栈提取真正调用 log 的位置，避免排障时只能看到统一的 logger.js。
  const stackLines = String(new Error().stack || "").split("\n").slice(2);
  const callerLine = stackLines.find((line) => !line.includes("logger.js")) || "";
  const matched = callerLine.match(/\((.*):(\d+):(\d+)\)/) || callerLine.match(/at (.*):(\d+):(\d+)/);
  if (!matched) return "phone_download.js:0";
  return `${path.basename(matched[1])}:${matched[2]}`;
}

function log(step, detail = "") {
  console.log(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}][${callerLocation()}][主线:自动下载][${step}][${detail}]`);
}

module.exports = { log };
