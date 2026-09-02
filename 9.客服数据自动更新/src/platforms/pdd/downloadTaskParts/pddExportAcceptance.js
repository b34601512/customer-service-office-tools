const PDD_EXPORT_RESPONSE_PATH = "/chats/csReportDetail/download";
const PDD_EXPORT_RESPONSE_TIMEOUT_MS = 10000;

function isPddExportResponse(response) {
  // 该函数只判断网络回应是否属于拼多多客服报表导出请求。
  try {
    return new URL(String(response?.url || "")).pathname === PDD_EXPORT_RESPONSE_PATH;
  } catch {
    return false;
  }
}

function waitForPddExportAccepted(cdpSession) {
  // 该函数只等待拼多多明确返回本次导出成功，避免把按钮点击当成下载开始。
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("拼多多下载失败：点击下载表单后未收到平台导出回应。"));
    }, PDD_EXPORT_RESPONSE_TIMEOUT_MS);

    cdpSession.on("Network.responseReceived", ({ response }) => {
      if (!isPddExportResponse(response)) {
        return;
      }
      clearTimeout(timeoutId);
      if (Number(response.status) !== 200) {
        reject(new Error(`拼多多下载失败：平台导出回应异常，状态=${response.status}。`));
        return;
      }
      resolve();
    });
  });
}

async function triggerPddExportAndWaitForAcceptance(page, triggerExport) {
  // 该函数只把一次拼多多导出动作和它的真实平台回应绑定在一起。
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send("Network.enable");
  try {
    await Promise.all([waitForPddExportAccepted(cdpSession), triggerExport()]);
  } finally {
    await cdpSession.detach();
  }
}

module.exports = {
  triggerPddExportAndWaitForAcceptance
};
