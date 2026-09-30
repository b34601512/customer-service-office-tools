// 金山文档（只读）共享库 —— **唯一出处**（2026-09-30 用户拍板：「要，最好是统一一个，别同样的动作每次到处改」）。
//
// 原来 22/24/25 号各有一份逐字相同的：
//   src/engine/kdocs.js（205 行）、src/engine/kdocsAirScript.js（95 行）、
//   src/tools/read-kdocs.js（150 行）、src/tools/kdocs-query.js、src/tools/kdocs-filter.js
// 现在它们都只是薄壳，逻辑在这里：
//
//   读表核心.js     ← 匿名无头读分享链接（listSheets / readSheet / readSheets）
//   脚本客户端.js   ← 调文档里已保存的 AirScript 只读脚本（runAirScript）
//   读表命令行.js   ← `read-kdocs.js` 的 CLI 逻辑
//   查询命令行.js   ← `kdocs-query.js` 的 CLI 逻辑
//   筛选命令行.js   ← `kdocs-filter.js` 的 CLI 逻辑
//
// 约定：chromium 由调用方注入（playwright-core 装在各项目自己的 node_modules，根目录没有）；
//       配置/日志/路径也由调用方注入（各项目自己的 project-config 与 log）。
module.exports = {
  ...require("./读表核心.js"),
  ...require("./脚本客户端.js"),
  ...require("./读表命令行.js"),
  ...require("./查询命令行.js"),
  ...require("./筛选命令行.js")
};
