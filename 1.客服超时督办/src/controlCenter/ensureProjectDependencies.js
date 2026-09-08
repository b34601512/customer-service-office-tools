const fs = require("fs");
const path = require("path");

async function ensureProjectDependencies(projectRoot) {
  const marker = path.join(projectRoot, "node_modules", "playwright-core", "package.json");
  if (!fs.existsSync(marker)) {
    throw new Error("运行依赖不完整：请重新解压完整分享包。开发环境请先执行 npm ci；程序不会自行联网安装依赖。");
  }
}

module.exports = { ensureProjectDependencies };
