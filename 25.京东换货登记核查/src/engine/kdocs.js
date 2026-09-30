// 金山读取核心 —— **逻辑已收拢到仓库根 `tools/金山表/`（2026-09-30，22/24/25 号共用一份）**。
// 这个文件现在只是薄壳：注入本项目 node_modules 里的 playwright-core（根目录没有它）。
//
// 对外 API 与以前完全一致：listSheets / readSheet / readSheets / resolveBrowserPath —— 调用方一行都不用改。
// 机制（踩坑换来的，别随手改）与改动说明都在 `tools/金山表/读表核心.js` 顶上。
const { 创建读表核心 } = require("../../../tools/金山表");

module.exports = 创建读表核心({ chromium: require("playwright-core").chromium });
