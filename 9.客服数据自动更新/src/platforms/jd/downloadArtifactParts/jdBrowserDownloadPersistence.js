// 该文件用于解决京东浏览器下载目录设置和下载文件最终落盘问题。
const fs = require("fs");
const { ensureDir } = require("../../../engine/fileSystem");

async function enableDownloadBehavior(page, downloadDir) {
  // 这里通过 CDP 明确指定下载目录，避免文件掉进系统默认下载目录后失控。
  ensureDir(downloadDir);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir
  });
}

function copyDownloadToFinalPath(downloadedPath, finalPath) {
  // 这里保留浏览器原始下载文件，只复制到正式目录，避免原始痕迹丢失。
  fs.copyFileSync(downloadedPath, finalPath);
}

module.exports = {
  enableDownloadBehavior,
  copyDownloadToFinalPath
};
