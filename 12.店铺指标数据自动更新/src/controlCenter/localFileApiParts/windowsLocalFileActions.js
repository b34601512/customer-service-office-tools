// 该文件用于通过 Windows 资源管理器显示已授权的本机文件或文件夹。
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function resolveExistingLocalPath(targetPath) {
  const normalizedTargetPath = path.resolve(String(targetPath || ""));
  if (!fs.existsSync(normalizedTargetPath)) {
    throw new Error(`本机路径不存在：${normalizedTargetPath}`);
  }
  return normalizedTargetPath;
}

function buildExplorerArguments(targetPath) {
  const normalizedTargetPath = resolveExistingLocalPath(targetPath);
  const targetStat = fs.statSync(normalizedTargetPath);
  return targetStat.isDirectory()
    ? [normalizedTargetPath]
    : ["/select,", normalizedTargetPath];
}

function resolveWorkbookFolder(workbookPath) {
  const normalizedWorkbookPath = path.resolve(String(workbookPath || ""));
  const workbookFolder = path.dirname(normalizedWorkbookPath);
  if (!fs.existsSync(workbookFolder) || !fs.statSync(workbookFolder).isDirectory()) {
    throw new Error(`汇总表文件夹不存在：${workbookFolder}`);
  }
  return workbookFolder;
}

function revealLocalPath(targetPath) {
  return startDetachedProcess(
    "explorer.exe",
    buildExplorerArguments(targetPath),
    "打开文件位置失败"
  );
}

function openLocalFile(targetPath) {
  const normalizedTargetPath = resolveExistingLocalPath(targetPath);
  if (!fs.statSync(normalizedTargetPath).isFile()) {
    throw new Error(`要打开的路径不是文件：${normalizedTargetPath}`);
  }
  return startDetachedProcess(
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", normalizedTargetPath],
    "打开本机文件失败"
  );
}

function openExternalUrl(targetUrl) {
  const normalizedTargetUrl = String(targetUrl || "").trim();
  let parsedTargetUrl;
  try {
    parsedTargetUrl = new URL(normalizedTargetUrl);
  } catch {
    throw new Error(`要打开的网页地址无效：${normalizedTargetUrl || "未设置"}`);
  }
  if (!["http:", "https:"].includes(parsedTargetUrl.protocol)) {
    throw new Error("只允许打开 http 或 https 网页地址。");
  }
  return startDetachedProcess(
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", parsedTargetUrl.toString()],
    "打开网页失败"
  );
}

function startDetachedProcess(executablePath, processArguments, errorMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const childProcess = spawn(executablePath, processArguments, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    childProcess.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`${errorMessage}：${error.message}`));
    });
    childProcess.unref();
    setImmediate(() => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
}

module.exports = {
  buildExplorerArguments,
  resolveWorkbookFolder,
  revealLocalPath,
  openLocalFile,
  openExternalUrl
};
