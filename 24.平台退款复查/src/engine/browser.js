// 受控浏览器引擎 —— **逻辑已收拢到仓库根 `tools/浏览器引擎/index.js`（2026-09-30，22/24/25/26 号共用一份）**。
// 这个文件现在只是薄壳：把本项目的 `log` 和本项目 node_modules 里的 `playwright-core` 注进去。
//
// 对外 API 与以前完全一致：openStoreBrowser / attachStoreBrowser / probeDebugPort / isPortFree /
// resolveBrowserPath / portUsesProfileDir / firstPage / sleep —— 调用方一行都不用改。
//
// 机制（踩坑换来的，别随手改）与改动说明都在 `tools/浏览器引擎/index.js` 顶上：
// 一个店铺 = 一个 profile 目录 + 固定调试端口；窗口开着就附着复用（登录态在 profile 里）；
// 端口上不是本店铺 profile 就不接；附着到的窗口 close() 只断引用、不关窗口。
const { log } = require("./log");
const { 创建 } = require("../../../tools/浏览器引擎");

module.exports = 创建({ log, chromium: require("playwright-core").chromium });
