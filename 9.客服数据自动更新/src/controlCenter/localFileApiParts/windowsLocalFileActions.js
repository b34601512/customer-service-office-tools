// 该文件用于解决通过 Windows Explorer 定位或打开已授权本机文件的问题。
const fs = require("fs");
const { spawn } = require("child_process");

function buildExplorerArguments(targetPath) {
  const stat = fs.statSync(targetPath);
  return stat.isDirectory() ? [targetPath] : ["/select,", targetPath];
}

function startExplorer(explorerArguments, errorMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const explorerProcess = spawn("explorer.exe", explorerArguments, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    explorerProcess.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`${errorMessage}：${error.message}`));
    });
    explorerProcess.unref();
    setImmediate(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    });
  });
}

function revealLocalPath(targetPath) {
  return startExplorer(buildExplorerArguments(targetPath), "打开文件位置失败");
}

function openLocalFile(targetPath) {
  return startExplorer([targetPath], "打开源文件失败");
}

function openExternalUrl(targetUrl) {
  return startExplorer([targetUrl], "打开网页失败");
}

module.exports = {
  buildExplorerArguments,
  revealLocalPath,
  openLocalFile,
  openExternalUrl
};
