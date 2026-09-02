const fs = require("fs");
const path = require("path");
const { readJsonObjectSafe } = require("../safeJson");

function readJsonFileIfExists(filePath) {
  // 该函数读取 JSON 状态文件：不存在或上次写入被中断损坏时都返回 null，避免一次文件损坏卡死启动主线（issue #554）。
  return readJsonObjectSafe(filePath, () => null, "运行状态快照");
}

function writeJsonStateFile(filePath, state) {
  // 该函数统一写回稳定 JSON，方便人工排查裁剪后的状态结构。
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

module.exports = {
  readJsonFileIfExists,
  writeJsonStateFile
};
