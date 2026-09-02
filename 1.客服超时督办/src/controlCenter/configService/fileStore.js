const fs = require("fs");

function readUtf8Text(filePath) {
  // 这里统一按 UTF-8 读取配置文件，避免中文文案和注释被系统默认编码破坏。
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8Text(filePath, content) {
  // 这里统一按 UTF-8 写回配置文件，避免生产配置因为编码错乱直接损坏。
  fs.writeFileSync(filePath, content, "utf8");
}

function readJsonObject(filePath, displayName) {
  // 这里统一读取 JSON 配置对象，配置损坏时直接抛中文错误，避免网页端保存后读出黑箱。
  if (!fs.existsSync(filePath)) {
    throw new Error(`未找到${displayName}：${filePath}`);
  }

  try {
    return JSON.parse(readUtf8Text(filePath));
  } catch (error) {
    throw new Error(`${displayName} 不是合法 JSON：${error.message}`);
  }
}

function writeJsonObject(filePath, payload) {
  // 这里统一按稳定格式写回 JSON，方便后续 diff 和人工排查。
  writeUtf8Text(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  readUtf8Text,
  writeUtf8Text,
  readJsonObject,
  writeJsonObject
};
