#!/usr/bin/env node
// 金山只读查询（AirScript）。**CLI 逻辑已收拢到仓库根 `tools/金山表/查询命令行.js`（2026-09-30，22/24/25 号共用一份）**。
// 这个文件现在只是薄壳：传「本项目根 + log + runAirScript」。配置在本项目 project-config/kdocs-airscript.json（不入库）。
//
// 用法（和以前一样）：
//   node src/tools/kdocs-query.js 5127667812586099609 [更多订单号...] [--sheets "退货退款表,异常件"] [--out 文件]
const { 跑查询命令行 } = require("../../../tools/金山表");
const { runAirScript } = require("../engine/kdocsAirScript");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

跑查询命令行({ argv: process.argv.slice(2), 项目根: projectPath(), log, runAirScript })
  .then(({ exitCode }) => { process.exitCode = exitCode; })
  .catch((error) => {
    log("金山查询", "失败", error.message);
    console.error(`\n  查询失败：${error.message}\n`);
    process.exitCode = 1;
  });
