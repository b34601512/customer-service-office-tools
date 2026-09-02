const fs = require("fs");
const { log } = require("./logger");

function resolveFallback(fallbackFactory) {
  if (typeof fallbackFactory === "function") {
    return fallbackFactory();
  }
  return fallbackFactory === undefined ? null : fallbackFactory;
}

function readJsonObjectSafe(filePath, fallbackFactory, displayName) {
  // 这里统一安全读取运行状态 JSON：文件缺失或损坏时回退空状态并记录日志，
  // 避免断电或写入中断导致的一次文件损坏，让整个控制台 / 监控链一起瘫痪。
  if (!filePath) {
    return resolveFallback(fallbackFactory);
  }

  if (!fs.existsSync(filePath)) {
    return resolveFallback(fallbackFactory);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const label = String(displayName || filePath);
    try {
      log(
        "主线:失败",
        "状态文件",
        "解析失败",
        `${label} 不是合法 JSON（可能上次写入被中断），已回退为空状态并等待下次覆盖：${error.message}`
      );
    } catch (logError) {
      // 这里保证安全读取本身永远不抛错，即使日志系统异常也不影响回退。
    }
    return resolveFallback(fallbackFactory);
  }
}

module.exports = {
  readJsonObjectSafe
};
