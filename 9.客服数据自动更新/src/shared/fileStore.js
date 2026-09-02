const fs = require("fs");
const path = require("path");

function ensureParentDir(filePath) {
  // 这里先补齐父目录，避免首次写配置时因为目录不存在直接失败。
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath, label) {
  // 这里统一读取 JSON 文件，出错时直接给出中文定位信息。
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} 读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJsonFileAtomic(filePath, payload) {
  // 这里统一走临时文件覆盖，避免生产配置写半截导致损坏。
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");

  fs.renameSync(tempPath, filePath);
}

module.exports = {
  readJsonFile,
  writeJsonFileAtomic
};
