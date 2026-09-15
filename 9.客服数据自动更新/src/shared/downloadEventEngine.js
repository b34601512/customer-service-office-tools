const { checkBrowserHumanRequirement } = require("../engine/browserHumanGuard");
const { assertAutomationActive, getAutomationScope, getAutomationTime } = require("../engine/browserAutomationScope");

function resolveAbsoluteDeadlineMs(timeoutMs) {
  // 人工等待时间不计入 automation time（这是为了让用户解验证码不烧掉下载时限），
  // 但这样存在一个真实风险：只要人工守卫反复耗时，自然超时可以被无限推迟，
  // 整轮任务会静默卡死、既不上报也不报错。这里再兜一层墙钟上限，
  // 保证无论如何都能在“下载时限 + 人工验证预算”内收敛，让失败变成可见的错误。
  const scope = getAutomationScope();
  const humanBudgetMs = Math.max(0, Number(scope?.humanTimeoutMs) || 0);
  return Date.now() + timeoutMs + humanBudgetMs;
}

async function waitForDownloadArtifactState(readArtifact, timeoutMs, pollIntervalMs) {
  // 这里统一重复读取下载产物状态，命中即返回，读取错误直接暴露。
  if (typeof readArtifact !== "function") {
    throw new Error("等待下载产物失败：缺少状态读取函数。");
  }
  const safeTimeoutMs = Math.max(1, Number(timeoutMs) || 120000);
  const safePollIntervalMs = Math.max(20, Number(pollIntervalMs) || 2000);
  const deadline = getAutomationTime() + safeTimeoutMs;
  const absoluteDeadlineMs = resolveAbsoluteDeadlineMs(safeTimeoutMs);

  while (true) {
    assertAutomationActive();
    const artifact = await readArtifact();
    if (artifact) {
      return artifact;
    }
    await checkBrowserHumanRequirement();
    const remainingMs = deadline - getAutomationTime();
    const wallRemainingMs = absoluteDeadlineMs - Date.now();
    if (remainingMs <= 0 || wallRemainingMs <= 0) {
      return null;
    }
    const sleepMs = Math.max(1, Math.min(safePollIntervalMs, remainingMs, wallRemainingMs));
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
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
