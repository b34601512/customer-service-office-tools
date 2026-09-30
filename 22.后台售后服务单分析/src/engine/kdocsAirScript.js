// 金山 AirScript 客户端 —— **逻辑已收拢到仓库根 `tools/金山表/`（2026-09-30，22/24/25 号共用一份）**。
// 这个文件现在只是薄壳：把本项目的「项目根 + log」传进去（配置仍在本项目 project-config/kdocs-airscript.json，不入库）。
//
// 对外 API 与以前完全一致：runAirScript / readAirScriptConfig / resolveWebhook / CONFIG_PATH。
// 协议要点（AirScript-Token、Context.argv、data.result、脚本必须已保存）见 `tools/金山表/脚本客户端.js`。
const { 创建脚本客户端 } = require("../../../tools/金山表");
const { projectPath } = require("../config/stores");
const { log } = require("./log");

module.exports = 创建脚本客户端({ 项目根: projectPath(), log });
