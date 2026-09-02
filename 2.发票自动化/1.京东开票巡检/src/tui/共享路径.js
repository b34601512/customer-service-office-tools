// 共享 TUI 框架路径解析：各子项目复用 2.发票自动化/共享CLI/tui 下的框架文件。
const path = require("path");
const fs = require("fs");

function 解析共享框架文件(文件名) {
  const 候选列表 = [
    path.resolve(__dirname, "../../../共享CLI/tui", 文件名),
    path.resolve(__dirname, "../../共享CLI/tui", 文件名),
  ];
  const 目标 = 候选列表.find((候选) => fs.existsSync(候选));
  if (!目标) throw new Error(`找不到共享 TUI 框架文件：${文件名}`);
  return 目标;
}

function 加载共享框架(文件名) {
  return require(解析共享框架文件(文件名));
}

module.exports = {
  解析共享框架文件,
  加载共享框架,
  ansi: 加载共享框架("ansi.js"),
  width: 加载共享框架("width.js"),
  format: 加载共享框架("format.js"),
  tuiApp: 加载共享框架("tuiApp.js"),
  控制台捕获: 加载共享框架("控制台捕获.js"),
};
