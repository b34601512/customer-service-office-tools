const fs = require("fs");
const appConfig = require("../config/appConfig");
const { log } = require("./logger");

function resolveEdgePath(logModuleName = "浏览器引擎") {
  // 所有浏览器入口只使用系统现代 Edge，不下载另一套浏览器或回退 Chrome。
  for (const edgePath of appConfig.edgePaths) {
    if (edgePath && fs.existsSync(edgePath)) {
      log("主线:准备", logModuleName, "定位Edge", `已找到 Microsoft Edge：${edgePath}`);
      return edgePath;
    }
  }

  throw new Error("未找到现代 Microsoft Edge，请安装或更新 Edge 后重试；无需安装谷歌浏览器。");
}

module.exports = {
  resolveEdgePath
};
