// 受控浏览器引擎薄壳：与 22/24/25/26 号共用仓库根 tools/浏览器引擎（一个店铺 = 一个 profile + 一个调试端口）。
const { 创建 } = require("../../../tools/浏览器引擎");

module.exports = 创建({
  log: (...args) => console.log("[浏览器]", ...args),
  chromium: require("playwright-core").chromium
});
