const {
  JD_DATE_STATE_POLL_INTERVAL_MS,
  waitForNextJdDateStateCheck
} = require("../dateStateParts/jdDateStatePolling");
const { pickVisibleJdLocator } = require("../dateStateParts/jdVisibleLocator");
const { parseJdSystemPanelMonth } = require("./jdSystemDateMonth");

const JD_SYSTEM_DATE_PANEL_SELECTOR = [
  ".kf-manage-lite-picker-dropdown",
  ".kf-manage-lite-picker-panel-container"
].join(", ");

function listJdSystemDatePanelRoots(surface) {
  // 这个函数只列出系统日期弹层可能存在的 frame 与主页面根。
  const roots = [];
  if (surface && typeof surface.locator === "function") {
    roots.push(surface);
  }
  const surfacePage = typeof surface?.page === "function" ? surface.page() : null;
  if (surfacePage && surfacePage !== surface && typeof surfacePage.locator === "function") {
    roots.push(surfacePage);
  }
  return roots;
}

async function findVisibleJdSystemDatePanel(surface) {
  // 这个函数只在可能的页面根中查找当前可见日期面板。
  for (const root of listJdSystemDatePanelRoots(surface)) {
    const panel = await pickVisibleJdLocator(root.locator(JD_SYSTEM_DATE_PANEL_SELECTOR));
    if (panel) {
      return panel;
    }
  }
  return null;
}

async function waitForVisibleJdSystemDatePanel(surface, options = {}) {
  // 这个函数只等待点击后异步挂载的系统日期面板变为可见。
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 8000);
  const pollIntervalMs = Math.max(20, Number(options.pollIntervalMs) || 200);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const panel = await findVisibleJdSystemDatePanel(surface);
    if (panel) {
      return panel;
    }
    await waitForNextJdDateStateCheck(deadline, pollIntervalMs);
  }
  throw new Error("点击京东系统日期控件后，没有看到可操作的日期面板。");
}

async function readJdSystemPanelMonths(panel) {
  // 这个函数只读取系统日期面板左右两个月份标题。
  const headers = panel.locator(".kf-manage-lite-picker-panel .kf-manage-lite-picker-header-view");
  const count = await headers.count();
  if (count < 2) {
    throw new Error("京东系统日期面板缺少左右月份标题。");
  }
  return {
    left: parseJdSystemPanelMonth(await headers.nth(0).innerText()),
    right: parseJdSystemPanelMonth(await headers.nth(1).innerText())
  };
}

async function waitForJdSystemPanelMonthsChanged(panel, previousMonths, timeoutMs = 10000) {
  // 这个函数只等待一次切月后左右月份标题发生变化。
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const currentMonths = await readJdSystemPanelMonths(panel);
    if (currentMonths.left.text !== previousMonths.left.text || currentMonths.right.text !== previousMonths.right.text) {
      return currentMonths;
    }
    await waitForNextJdDateStateCheck(deadline, JD_DATE_STATE_POLL_INTERVAL_MS);
  }
  throw new Error("京东系统日期面板切月后一直没有刷新到新的月份。");
}

module.exports = {
  findVisibleJdSystemDatePanel,
  waitForVisibleJdSystemDatePanel,
  readJdSystemPanelMonths,
  waitForJdSystemPanelMonthsChanged
};
