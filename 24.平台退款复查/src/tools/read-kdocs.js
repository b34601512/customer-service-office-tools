#!/usr/bin/env node
// 读金山文档（只读）。**CLI 逻辑已收拢到仓库根 `tools/金山表/读表命令行.js`（2026-09-30，22/24/25 号共用一份）**。
// 这个文件现在只是薄壳：传「本项目根 + log + 读表核心 + 本机默认表链接」。
//
// 用法（和以前一样）：
//   node src/tools/read-kdocs.js --url "https://www.kdocs.cn/l/<对接表分享ID>" --list
//   node src/tools/read-kdocs.js --sheet "退货退款表" --head 5
//   node src/tools/read-kdocs.js --all --grep "5127667812586099609"     # 跨全部工作表搜（推荐）
const fs = require("fs");
const path = require("path");
const 读表 = require("../engine/kdocs");
const { 跑读表命令行 } = require("../../../tools/金山表");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const DEFAULT_URL = readLocalKdocsUrl("huaihuaDuijieTable", "https://www.kdocs.cn/l/<对接表分享ID>"); // 2026年【湖南怀化售后】对接表

function readLocalKdocsUrl(key, fallback) {
  // 这里从本机 project-config/kdocs-links.local.json 读真实表链接（该文件已 gitignore）；没配置时返回占位值。
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(projectPath("project-config"), "kdocs-links.local.json"), "utf8"));
    const value = String(payload[key] || "").trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

跑读表命令行({ argv: process.argv.slice(2), 项目根: projectPath(), log, 读表, 默认URL: DEFAULT_URL })
  .then(({ exitCode }) => { process.exitCode = exitCode; })
  .catch((error) => {
    log("金山", "失败", error.stack || error.message);
    console.error(`\n  读取失败：${error.message}\n`);
    process.exitCode = 1;
  });
