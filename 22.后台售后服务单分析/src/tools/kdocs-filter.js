#!/usr/bin/env node
// 反向检查：金山「只读筛选未退款」。**CLI 逻辑已收拢到仓库根 `tools/金山表/筛选命令行.js`（2026-09-30，22/24 号共用一份）**。
// 这个文件现在只是薄壳：传「本项目根 + log + runAirScript」。配置在本项目 project-config/kdocs-airscript.json（不入库）。
//
// 用法（和以前一样）：
//   node src/tools/kdocs-filter.js [--limit 500] [--out runtime/kdocs/待提醒-未退款.json] [--sheet "退货退款表"] [--ok-status 已退款]
// 注意：只读、只出清单，**不会发送任何消息**（发群前必须用户确认）。
const { 跑筛选命令行 } = require("../../../tools/金山表");
const { runAirScript } = require("../engine/kdocsAirScript");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

跑筛选命令行({ argv: process.argv.slice(2), 项目根: projectPath(), log, runAirScript })
  .then(({ exitCode }) => { process.exitCode = exitCode; })
  .catch((error) => {
    log("未退款筛选", "失败", error.message);
    console.error(`\n  失败：${error.message}\n`);
    process.exitCode = 1;
  });
