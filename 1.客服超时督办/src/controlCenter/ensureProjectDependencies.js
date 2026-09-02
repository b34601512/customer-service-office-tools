const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { log, logError, resetCurrentLogFileOnce } = require("../engine/logger");

function getPlaywrightCoreMarker(projectRoot) {
  // 这里用依赖包自己的 package.json 作为唯一真相，避免 node_modules 目录存在但安装不完整。
  return path.join(projectRoot, "node_modules", "playwright-core", "package.json");
}

function getNpmInstallInvocation() {
  // Windows 上直接 spawn npm.cmd 在部分 Node 版本会触发 EINVAL，所以统一交给 cmd 解析 npm 命令。
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm install"],
      displayName: "npm install"
    };
  }

  return {
    command: "npm",
    args: ["install"],
    displayName: "npm install"
  };
}

async function ensureProjectDependencies(projectRoot) {
  // 这里在真正启动任何业务任务前先确认项目依赖齐全，避免运行到一半才因缺模块直接炸掉。
  const markerPath = getPlaywrightCoreMarker(projectRoot);
  if (fs.existsSync(markerPath)) {
    log("主线:执行", "依赖预检", "检查项目依赖", `依赖已就绪，已检测到：${path.relative(projectRoot, markerPath)}`);
    return;
  }

  const installInvocation = getNpmInstallInvocation();
  log("主线:执行", "依赖预检", "安装项目依赖", `未检测到「playwright-core」，现在开始执行 ${installInvocation.displayName}。`);
  const installResult = spawnSync(installInvocation.command, installInvocation.args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (installResult.error) {
    throw new Error(`项目依赖安装命令启动失败：${installResult.error.message}，错误码=${installResult.error.code ?? "未知"}。`);
  }

  if (installResult.status !== 0) {
    throw new Error(`项目依赖安装失败，npm install 退出码=${installResult.status ?? "null"}，信号=${installResult.signal ?? "null"}。`);
  }

  if (!fs.existsSync(markerPath)) {
    throw new Error("项目依赖安装后仍未检测到「playwright-core」，请检查 npm 输出。");
  }

  log("主线:完成", "依赖预检", "安装项目依赖", "项目依赖安装完成，可以继续启动控制台。");
}

async function main() {
  // 这里让启动批处理也能复用同一套依赖预检，避免双入口逻辑分叉。
  const projectRoot = path.resolve(__dirname, "..", "..");
  resetCurrentLogFileOnce();
  await ensureProjectDependencies(projectRoot);
}

if (require.main === module) {
  main().catch((error) => {
    logError("主线:失败", "依赖预检", "安装项目依赖", error);
    process.exit(1);
  });
}

module.exports = {
  ensureProjectDependencies
};
