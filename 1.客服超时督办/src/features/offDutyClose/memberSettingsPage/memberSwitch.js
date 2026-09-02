// 该文件用于切换成员设置页里的成员开关。
const appConfig = require("../../../config/appConfig");
const { log } = require("../../../engine/logger");
const { waitForPageFunction } = require("../../../engine/pageWait");
const { getMemberRowLocator } = require("./rowLocator");

async function setMemberSwitch(page, staffName, switchIndex, targetEnabled, switchLabel) {
  // 这里统一切换成员开关，只在状态不一致时点击，避免无意义操作污染日志。
  const rowLocator = await getMemberRowLocator(page, staffName);
  const switchLocator = rowLocator.locator('button[role="switch"]').nth(switchIndex);
  const currentValue = (await switchLocator.getAttribute("aria-checked")) === "true";
  if (currentValue === targetEnabled) {
    return false;
  }

  log(
    "主线:执行",
    "下班页面",
    `切换${switchLabel}`,
    `客服=${staffName}，目标=${targetEnabled ? "开启" : "关闭"}`
  );
  await switchLocator.click();
  await waitForPageFunction(
    page,
    ([rowKey, index, expectedValue]) => {
      const row = document.querySelector(`tr[data-row-key="${rowKey}"]`);
      if (!row) {
        return false;
      }

      const switches = row.querySelectorAll('button[role="switch"]');
      return switches[index]?.getAttribute("aria-checked") === expectedValue;
    },
    [await rowLocator.getAttribute("data-row-key"), switchIndex, targetEnabled ? "true" : "false"],
    { timeout: appConfig.pageReadyTimeout }
  );
  return true;
}

async function setMemberAutoAssign(page, staffName, targetEnabled) {
  return setMemberSwitch(page, staffName, 0, targetEnabled, "自动分配");
}

async function setMemberTransferEnabled(page, staffName, targetEnabled) {
  return setMemberSwitch(page, staffName, 1, targetEnabled, "是否可被转接");
}

module.exports = {
  setMemberSwitch,
  setMemberAutoAssign,
  setMemberTransferEnabled
};
