const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { clickVisibleText } = require("../jdPageGuards");

const JD_SYSTEM_INDICATOR_EDITOR_TEXT = "编辑指标";
const JD_SYSTEM_INDICATOR_SAVE_TEXT = "保存";
const JD_SYSTEM_DRAWER_SCROLL_STEP_RATIO = 0.8;
const JD_SYSTEM_DRAWER_MAX_SCROLL_STEPS = 20;

async function clickJdSystemIndicatorEditor(surface) {
  // 这个函数只点击京东系统“编辑指标”按钮。
  const clicked = await clickVisibleText(surface, [JD_SYSTEM_INDICATOR_EDITOR_TEXT]);
  if (!clicked) {
    throw new Error("京东系统指标校验失败：没有找到「编辑指标」按钮。");
  }
}

async function waitForJdSystemIndicatorDrawer(surface) {
  // 这个函数只等待指标编辑抽屉可见并返回抽屉 locator。
  const drawer = surface.locator(".kf-manage-lite-drawer-open");
  await drawer.waitFor({ state: "visible", timeout: 10000 });
  return drawer;
}

async function resetJdSystemIndicatorDrawerScroll(drawer) {
  // 这个函数只把指标抽屉滚动位置重置到顶部。
  await drawer
    .locator(".kf-manage-lite-drawer-body, .ant-drawer-body, .el-drawer__body")
    .first()
    .evaluate((node) => {
      node.scrollTop = 0;
    });
}

async function scrollJdSystemIndicatorDrawerOnce(drawer) {
  // 这个函数只把指标抽屉向下滚动 0.8 个可视高度。
  return drawer
    .locator(".kf-manage-lite-drawer-body, .ant-drawer-body, .el-drawer__body")
    .first()
    .evaluate((node, stepRatio) => {
      const beforeTop = node.scrollTop;
      const step = Math.max(120, Math.floor(node.clientHeight * stepRatio));
      node.scrollTop = beforeTop + step;
      return node.scrollTop > beforeTop;
    }, JD_SYSTEM_DRAWER_SCROLL_STEP_RATIO);
}

async function findJdSystemMetricOptionInDrawer(drawer, metricLabel) {
  // 这个函数只滚动查找一个准确指标名对应的选项。
  await resetJdSystemIndicatorDrawerScroll(drawer);
  for (let stepIndex = 0; stepIndex <= JD_SYSTEM_DRAWER_MAX_SCROLL_STEPS; stepIndex += 1) {
    const metricOption = drawer.locator("label").filter({ hasText: metricLabel });
    const metricOptionCount = await metricOption.count();
    if (metricOptionCount > 0) {
      return { metricOption, metricOptionCount };
    }
    if (!(await scrollJdSystemIndicatorDrawerOnce(drawer))) {
      break;
    }
  }
  return {
    metricOption: drawer.locator("label").filter({ hasText: metricLabel }),
    metricOptionCount: 0
  };
}

async function ensureJdMetricCheckedInDrawer(drawer, metricLabel) {
  // 这个函数只确保抽屉中一个指标处于勾选状态。
  const { metricOption, metricOptionCount } = await findJdSystemMetricOptionInDrawer(drawer, metricLabel);
  if (metricOptionCount <= 0) {
    return { changed: false, unavailable: true };
  }
  if (metricOptionCount > 1) {
    throw new Error(`京东系统指标校验失败：指标面板出现多个「${metricLabel}」，无法判断应该勾选哪一个。`);
  }
  const className = await metricOption.getAttribute("class", { timeout: 3000 });
  if (String(className || "").includes("checked")) {
    return { changed: false, unavailable: false };
  }
  await clickLocatorWhenReady(metricOption, `京东指标「${metricLabel}」`, { timeoutMs: 5000 });
  return { changed: true, unavailable: false };
}

async function saveJdSystemIndicatorDrawer(drawer) {
  // 这个函数只点击唯一保存按钮并等待指标抽屉关闭。
  const saveButton = drawer.locator("button").filter({ hasText: JD_SYSTEM_INDICATOR_SAVE_TEXT });
  const saveButtonCount = await saveButton.count();
  if (saveButtonCount !== 1) {
    throw new Error(`京东系统指标校验失败：「保存」按钮数量异常=${saveButtonCount}。`);
  }
  await clickLocatorWhenReady(saveButton, "京东指标保存按钮", { timeoutMs: 5000 });
  await drawer.waitFor({ state: "hidden", timeout: 15000 });
}

module.exports = {
  clickJdSystemIndicatorEditor,
  waitForJdSystemIndicatorDrawer,
  ensureJdMetricCheckedInDrawer,
  saveJdSystemIndicatorDrawer
};
