async function waitForDownloadArtifactState(readArtifact, timeoutMs, pollIntervalMs) {
  // 这里统一重复读取下载产物状态，命中即返回，读取错误直接暴露。
  if (typeof readArtifact !== "function") {
    throw new Error("等待下载产物失败：缺少状态读取函数。");
  }
  const safeTimeoutMs = Math.max(1, Number(timeoutMs) || 120000);
  const safePollIntervalMs = Math.max(20, Number(pollIntervalMs) || 2000);
  const deadline = Date.now() + safeTimeoutMs;

  while (true) {
    const artifact = readArtifact();
    if (artifact) {
      return artifact;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(safePollIntervalMs, remainingMs)));
  }

}

async function waitForDownloadArtifact(options = {}) {
  // 这里统一等待浏览器写入指定目录的真实文件，目录是唯一下载真源。
  const {
    downloadDir,
    timeoutMs = 60000,
    pollIntervalMs = 1500,
    findNewArtifact,
    actionText = "点击下载"
  } = options;
  if (!downloadDir) {
    throw new Error("等待下载开始失败：缺少下载目录。");
  }
  if (typeof findNewArtifact !== "function") {
    throw new Error("等待下载开始失败：缺少新文件识别函数。");
  }

  const artifact = await waitForDownloadArtifactState(
    () => findNewArtifact(downloadDir),
    timeoutMs,
    pollIntervalMs
  );
  if (artifact) {
    return artifact;
  }
  throw new Error(`${actionText}后 ${Math.ceil(timeoutMs / 1000)} 秒内没有在指定目录检测到新文件。`);
}

async function triggerDownloadAndWait(waitForDownloadStart, triggerDownload) {
  // 这里先启动下载监听再触发点击，并由同一个 Promise 持有两项结果，避免留下孤立拒绝任务。
  const [downloadStart] = await Promise.all([waitForDownloadStart(), triggerDownload()]);
  return downloadStart;
}

module.exports = {
  waitForDownloadArtifactState,
  waitForDownloadArtifact,
  triggerDownloadAndWait
};
