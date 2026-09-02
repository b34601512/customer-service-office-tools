const appConfig = require("../../config/appConfig");
const {
  buildPersistedWecomRobotConfig,
  buildWecomRobotConfigModel
} = require("../../config/wecomRobotConfigModel");
const { log } = require("../../engine/logger");
const { readJsonObject, writeJsonObject } = require("./fileStore");

const wecomRobotConfigPath = appConfig.wecomRobotConfigPath;

function readWecomRobotConfig() {
  // 这里统一返回企微提醒配置，主管端恢复新电脑时只需要网页填写一次即可。
  const payload = readJsonObject(wecomRobotConfigPath, "企微机器人配置文件");
  return buildWecomRobotConfigModel(payload);
}

function saveWecomRobotConfig(payload) {
  // 这里统一验证并保存企微提醒配置，避免主管端换电脑时还得手改 JSON。
  const nextConfig = buildPersistedWecomRobotConfig(payload);
  writeJsonObject(wecomRobotConfigPath, nextConfig);
  log("主线:完成", "网页控制台", "保存企微提醒", "企微提醒配置写入完成");
  return readWecomRobotConfig();
}

module.exports = {
  readWecomRobotConfig,
  saveWecomRobotConfig
};
