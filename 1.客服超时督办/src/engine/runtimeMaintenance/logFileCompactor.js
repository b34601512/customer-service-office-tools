const fs = require("fs");

function normalizePositiveInteger(value, fallbackValue) {
  // 该函数把外部传入的阈值收口成正整数，避免错误配置把日志裁剪成空文件。
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.floor(numericValue)
    : fallbackValue;
}

function readFileTail(filePath, keepBytes) {
  // 该函数只读取文件尾部，避免超大日志裁剪时把整份日志一次性读进内存。
  const fileSize = fs.statSync(filePath).size;
  const bytesToRead = Math.min(fileSize, keepBytes);
  const buffer = Buffer.alloc(bytesToRead);
  const fileDescriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(fileDescriptor, buffer, 0, bytesToRead, fileSize - bytesToRead);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return buffer.toString("utf8");
}

function removePossiblyBrokenFirstLine(text) {
  // 该函数丢掉尾部截取时可能被截断的第一行，保证保留下来的日志从完整行开始。
  const newlineIndex = text.indexOf("\n");
  return newlineIndex >= 0 ? text.slice(newlineIndex + 1) : text;
}

function buildCompactionMarker(beforeBytes, keepBytes) {
  // 该函数写入裁剪标记，让现场排查时能知道日志不是异常丢失，而是自动治理过。
  const timeText = new Date().toLocaleString("zh-CN", { hour12: false });
  return `[${timeText}][logFileCompactor.js:0][主线:执行][运行膨胀治理][裁剪日志] 当前日志超过上限，已保留最后 ${(keepBytes / 1024 / 1024).toFixed(2)} MB；裁剪前 ${(beforeBytes / 1024 / 1024).toFixed(2)} MB`;
}

function compactLogFileIfNeeded(logFilePath, options = {}) {
  // 该函数在日志超过上限时只保留尾部现场，防止长时间运行把磁盘和网页日志拖慢。
  const maxBytes = normalizePositiveInteger(options.maxBytes, 5 * 1024 * 1024);
  const keepBytes = Math.min(normalizePositiveInteger(options.keepBytes, 2 * 1024 * 1024), maxBytes);
  if (!fs.existsSync(logFilePath)) {
    return { changed: false, beforeBytes: 0, afterBytes: 0 };
  }

  const beforeBytes = fs.statSync(logFilePath).size;
  if (beforeBytes <= maxBytes) {
    return { changed: false, beforeBytes, afterBytes: beforeBytes };
  }

  const tailText = removePossiblyBrokenFirstLine(readFileTail(logFilePath, keepBytes));
  const compactedText = `${buildCompactionMarker(beforeBytes, keepBytes)}\n${tailText}`;
  fs.writeFileSync(logFilePath, compactedText, "utf8");
  return {
    changed: true,
    beforeBytes,
    afterBytes: Buffer.byteLength(compactedText, "utf8")
  };
}

module.exports = {
  compactLogFileIfNeeded,
  removePossiblyBrokenFirstLine
};
