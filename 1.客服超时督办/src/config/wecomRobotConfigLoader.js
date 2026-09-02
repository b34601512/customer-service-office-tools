const fs = require("fs");
const appConfig = require("./appConfig");
const { buildWecomRobotConfigModel } = require("./wecomRobotConfigModel");

function readJsonFile(filePath, displayName) {
  // 这里统一读取企微机器人配置，并在配置损坏时直接抛出中文原因。
  if (!fs.existsSync(filePath)) {
    throw new Error(`未找到${displayName}：${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${displayName} 不是合法的 JSON：${error.message}`);
  }
}

function loadWecomRobotConfig() {
  // 这里统一读取企微机器人配置，后续更换 webhook 或补手机号只改配置文件即可。
  const config = readJsonFile(appConfig.wecomRobotConfigPath, "企微机器人配置文件");
  return buildWecomRobotConfigModel(config);
}

module.exports = {
  loadWecomRobotConfig
};
