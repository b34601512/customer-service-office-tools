const {
  dismissBlockingPopups,
  runAfterDismissingBlockingPopups
} = require("../../../shared/blockingPopupEngine");
const { DOUYIN_POLL_INTERVAL_MS } = require("./douyinDownloadSettings");

function getDouyinExportButton(page) {
  // 该函数只定位唯一的真实导出按钮，不再用页面脚本穿透遮挡层。
  return page.locator("button:visible").filter({ hasText: /^\s*导出数据\s*$/ });
}

async function readDouyinExportButtonState(page) {
  // 该函数只读取唯一导出按钮的数量和可用状态。
  const exportButton = getDouyinExportButton(page);
  const count = await exportButton.count();
  if (count !== 1) {
    return { count, disabled: false };
  }
  return {
    count,
    disabled: await exportButton.isDisabled()
  };
}

async function waitForDouyinExportButtonReady(page, timeoutMs = 10000) {
  // 该函数只等待唯一导出按钮变为可用。
  const deadline = Date.now() + timeoutMs;
  let lastState = { count: 0, disabled: false };
  while (Date.now() <= deadline) {
    lastState = await readDouyinExportButtonState(page);
    if (lastState.count === 1 && !lastState.disabled) {
      return;
    }
    await page.waitForTimeout(DOUYIN_POLL_INTERVAL_MS);
  }
  if (lastState.count === 0) {
    throw new Error("未找到抖音「导出数据」按钮。");
  }
  if (lastState.count > 1) {
    throw new Error(`抖音页面出现多个可见「导出数据」按钮：${lastState.count} 个。`);
  }
  throw new Error("抖音「导出数据」按钮当前不可用，请确认页面查询后有数据。");
}

async function clickDouyinExportButton(page) {
  // 该函数只在清除已知遮挡弹窗后，真实点击唯一导出按钮。
  await dismissBlockingPopups(page, { platformName: "抖音" });
  await waitForDouyinExportButtonReady(page);
  await runAfterDismissingBlockingPopups(
    page,
    () => getDouyinExportButton(page).click({ timeout: 10000 }),
    { platformName: "抖音" }
  );
}

module.exports = {
  waitForDouyinExportButtonReady,
  clickDouyinExportButton
};
