// 该文件只保留 runtime 初始化入口；长期浏览器资料由浏览器会话模块统一维护。
const { initializeRuntimeLayout } = require("./runtimeLayoutServiceParts/runtimeLayoutInitializer");

module.exports = {
  initializeRuntimeLayout
};
