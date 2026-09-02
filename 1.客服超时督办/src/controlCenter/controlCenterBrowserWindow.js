const fs = require("fs");
const { spawn } = require("child_process");
const appConfig = require("../config/appConfig");
const { log } = require("../engine/logger");
const { resolveChromePath } = require("../engine/browserExecutable");
const { processExistsByPid } = require("../engine/processPid");
const { killProcessTree } = require("./processTree");

function buildControlCenterBrowserArgs(url) {
  // 这里统一构造独立控制台窗口参数，确保网页窗口可被父进程精准回收。
  return [
    `--user-data-dir=${appConfig.controlCenterUserDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-background-mode",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--metrics-recording-only",
    `--disk-cache-size=${appConfig.controlCenterBrowserDiskCacheSizeBytes}`,
    `--media-cache-size=${appConfig.controlCenterBrowserDiskCacheSizeBytes}`,
    "--disable-features=OptimizationHints,MediaRouter,Translate,GlobalMediaControls,HttpsUpgrades,AutofillServerCommunication",
    "--new-window",
    `--app=${url}`
  ];
}

function launchDetachedBrowserWindow(executablePath, args, workingDirectory) {
  // 这里统一拉起独立浏览器进程，并把 PID 留给控制台后续强制关闭。
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      cwd: workingDirectory,
      detached: true,
      stdio: "ignore"
    });

    let settled = false;

    child.once("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(`启动控制台网页失败：${error.message}`));
    });

    child.once("spawn", () => {
      if (settled) {
        return;
      }

      settled = true;
      child.unref();
      resolve(child.pid);
    });
  });
}

class ControlCenterBrowserWindow {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.browserProcess = null;
  }

  async open(url) {
    // 这里统一拉起受控控制台网页窗口，避免默认浏览器普通标签页无法自动关掉。
    if (this.browserProcess) {
      return;
    }

    fs.mkdirSync(appConfig.controlCenterUserDataDir, { recursive: true });
    const executablePath = resolveChromePath("网页控制台");
    const args = buildControlCenterBrowserArgs(url);
    log("主线:启动", "网页控制台", "拉起控制台网页", `准备启动独立控制台窗口，url=${url}`);
    const pid = await launchDetachedBrowserWindow(executablePath, args, this.projectRoot);
    this.browserProcess = {
      pid,
      url
    };
    log("主线:完成", "网页控制台", "拉起控制台网页", `独立控制台网页已启动，PID=${pid}`);
  }

  async close() {
    // 这里统一关闭独立控制台网页窗口，保证后台任务退出后页面也跟着收掉。
    if (!this.browserProcess) {
      return;
    }

    const { pid } = this.browserProcess;
    log("主线:停止", "网页控制台", "关闭控制台网页", `准备关闭独立控制台窗口，PID=${pid}`);
    this.browserProcess = null;
    await killProcessTree(pid);
    log("主线:完成", "网页控制台", "关闭控制台网页", "独立控制台网页已关闭");
  }

  async isOpen() {
    // 这里只判断控制台窗口主进程是否仍存活，让退出监控不关心进程检测细节。
    if (!this.browserProcess || !this.browserProcess.pid) {
      return false;
    }

    const isRunning = processExistsByPid(this.browserProcess.pid);
    if (!isRunning) {
      this.browserProcess = null;
    }
    return isRunning;
  }

  getProcessId() {
    // 该函数给资源统计接口提供受控浏览器根进程 PID，避免接口层读取类内部结构。
    return this.browserProcess?.pid || null;
  }
}

module.exports = {
  ControlCenterBrowserWindow,
  buildControlCenterBrowserArgs
};
