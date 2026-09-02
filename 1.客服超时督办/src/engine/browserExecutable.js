const fs = require("fs");
const appConfig = require("../config/appConfig");
const { log } = require("./logger");

function resolveChromePath(logModuleName = "浏览器引擎") {
  // 这里统一定位 Chrome 可执行文件，避免多个模块各自判断路径导致口径分裂。
  for (const chromePath of appConfig.chromePaths) {
    if (chromePath && fs.existsSync(chromePath)) {
      log("主线:准备", logModuleName, "定位Chrome", `已找到 Chrome：${chromePath}`);
      return chromePath;
    }
  }

  throw new Error("未找到可用的 Chrome 路径，请先安装谷歌浏览器。");
}

module.exports = {
  resolveChromePath
};
