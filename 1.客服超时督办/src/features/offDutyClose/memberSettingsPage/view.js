// 该文件用于进入并确认成员设置页已就绪。
const appConfig = require("../../../config/appConfig");
const { applyBrowserWindowIdentity, navigateToTargetPage } = require("../../../engine/browser");
const { assertChatPageReady } = require("../../chatPage");

async function ensureMemberSettingsView(page) {
  // 这里统一切到「设置 -> 成员设置」，让上层动作都在同一页里执行。
  if (!page.url() || page.url() === "about:blank") {
    await navigateToTargetPage(page);
  }

  await assertChatPageReady(page);
  const tableHeader = page.getByText(/^成员名称$/, { exact: true });
  if ((await tableHeader.count()) > 0 && (await tableHeader.first().isVisible().catch(() => false))) {
    return;
  }

  await page.getByText(/^设置$/, { exact: true }).last().click();
  await page.getByText(/^成员设置$/, { exact: true }).click();
  await tableHeader.first().waitFor({
    state: "visible",
    timeout: appConfig.pageReadyTimeout
  });
}

async function reloadMemberSettingsView(page, windowLabel = "上班监控") {
  // 这里强制刷新成员设置页：其他电脑改了开关后，本机页面若不刷新会一直显示缓存旧状态，
  // 导致自动开关判断读到过期数据。刷新后重新确保进入成员设置页。
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await ensureMemberSettingsView(page);
  // 刷新会重置页面标题，这里补回窗口标识（默认上班监控），避免窗口标题丢失。
  await applyBrowserWindowIdentity(page, windowLabel).catch(() => {});
}

module.exports = {
  ensureMemberSettingsView,
  reloadMemberSettingsView
};
