const { readControlCenterConfig } = require("./configService/configReader");
const { saveControlCenterConfig } = require("./configService/configSaver");
const {
  readWecomRobotConfig,
  saveWecomRobotConfig
} = require("./configService/wecomConfigService");

module.exports = {
  readControlCenterConfig,
  saveControlCenterConfig,
  readWecomRobotConfig,
  saveWecomRobotConfig
};
