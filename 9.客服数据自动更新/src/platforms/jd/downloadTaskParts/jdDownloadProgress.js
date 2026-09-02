// 该文件用于解决京东下载阶段进度回传和系统模式解析问题。
const { log } = require("../../../engine/logger");
const { normalizeText } = require("../jdStateHelpers");

function reportProgress(onProgress, stageText, detail = "") {
  // 这里统一输出下载阶段进度，同时把当前阶段回推给CLI。
  log("主线:执行", "京东下载", stageText, detail || "已进入该阶段");
  if (typeof onProgress === "function") {
    onProgress(stageText, detail);
  }
}

function resolveJdDownloadMode(storeConfig) {
  // 这里读取京东下载模式，入口只接受系统模式。
  return normalizeText(storeConfig?.downloadMode).toLowerCase();
}

module.exports = {
  reportProgress,
  resolveJdDownloadMode
};
