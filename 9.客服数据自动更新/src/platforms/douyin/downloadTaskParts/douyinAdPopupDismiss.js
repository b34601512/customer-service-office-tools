const { log } = require("../../../engine/logger");
const { getAutomationTime } = require("../../../engine/browserAutomationScope");

// 该文件只负责识别并关闭抖音商家后台的营销/活动广告弹窗（如“七夕活动”“到店礼”等 arrival 弹层）。
// 抖音店铺选择面板是业务弹层，不属于广告，绝不能被这里关闭——
// 这正是 douyinStoreMenu 里迟迟不给切店点击套通用弹窗治理的原因。
const DOUYIN_AD_POPUP_SELECTORS = [
  ".ws-arrival-modal-wrap",
  "[class*='arrival-modal']",
  "[class*='arrival_modal']"
];
// 只认明确“关闭”语义的入口；促销 CTA（如“查看商品”“立即参与”）一律不点。
const DOUYIN_AD_CLOSE_SELECTORS = [
  "[aria-label='关闭']",
  "[aria-label*='close' i]",
  "[title='关闭']",
  "[class*='close' i]",
  "[data-testid*='close' i]",
  "[data-e2e*='close' i]"
];
const DOUYIN_AD_CLOSE_TEXTS = ["关闭", "我知道了", "知道了", "暂不需要", "稍后再说"];
const AD_POPUP_GONE_TIMEOUT_MS = 5000;
const AD_POPUP_POLL_INTERVAL_MS = 200;

function buildAdPopupSelector() {
  return DOUYIN_AD_POPUP_SELECTORS.map((selector) => `${selector}:visible`).join(", ");
}

async function findVisibleDouyinAdPopup(page) {
  // 该函数只按已实采到的广告弹窗结构定位唯一可见弹层；识别不了就不阻断主流程（主流程仍会自己报错）。
  try {
    const popups = page.locator(buildAdPopupSelector());
    const count = await popups.count();
    if (count === 0) {
      return null;
    }
    return popups.first();
  } catch (error) {
    log(
      "主线:诊断",
      "弹窗治理",
      "抖音广告弹窗识别失败",
      `原因=${String(error?.message || error).slice(0, 160)}`
    );
    return null;
  }
}

async function findOnlyExplicitAdCloseTarget(popup) {
  // 该函数只在广告弹窗内寻找唯一、明确的关闭入口，找不到就返回空交给 ESC 兜底。
  const semanticTargets = popup.locator(DOUYIN_AD_CLOSE_SELECTORS.map((s) => `${s}:visible`).join(", "));
  const semanticCount = await semanticTargets.count().catch(() => 0);
  if (semanticCount === 1) {
    return semanticTargets.first();
  }
  if (semanticCount > 1) {
    // 图标与容器常同时命中：按“最外层不被其它候选包含”去重，仍唯一才选中。
    const containerInfo = await semanticTargets.evaluateAll((elements) => elements.map((element, index) => {
      const containedBy = elements.find((other, otherIndex) => otherIndex !== index && other.contains(element));
      return { index, containedByIndex: containedBy ? elements.indexOf(containedBy) : -1 };
    })).catch(() => null);
    if (Array.isArray(containerInfo)) {
      const outermost = containerInfo.filter((item) => item.containedByIndex === -1);
      if (outermost.length === 1) {
        return semanticTargets.nth(outermost[0].index);
      }
    }
  }
  const textPattern = new RegExp(`^\\s*(?:${DOUYIN_AD_CLOSE_TEXTS.join("|")})\\s*$`);
  const textTargets = popup.getByText(textPattern);
  const textCount = await textTargets.count().catch(() => 0);
  return textCount === 1 ? textTargets.first() : null;
}

async function waitForAdPopupGone(page, timeoutMs = AD_POPUP_GONE_TIMEOUT_MS) {
  // 该函数只等待广告弹层真的不再可见，避免用“已点击”冒充“已关闭”。
  const deadline = getAutomationTime() + timeoutMs;
  while (getAutomationTime() <= deadline) {
    if (!await findVisibleDouyinAdPopup(page)) {
      return true;
    }
    await page.waitForTimeout(AD_POPUP_POLL_INTERVAL_MS);
  }
  return !await findVisibleDouyinAdPopup(page);
}

function isDouyinAdPopupDismissed(logPrefix) {
  log("主线:完成", "弹窗治理", "关闭抖音广告弹窗", `${logPrefix}，弹层已消失`);
}

async function dismissDouyinAdPopup(page) {
  // 该函数只关闭当前可见的抖音广告弹窗：优先点唯一明确关闭入口，没有则用 ESC 收起。
  const popup = await findVisibleDouyinAdPopup(page);
  if (!popup) {
    return false;
  }
  const closeTarget = await findOnlyExplicitAdCloseTarget(popup);
  if (closeTarget) {
    try {
      await closeTarget.click({ timeout: 3000 });
    } catch (error) {
      // 点击竞态：若弹层已因此消失，视为关闭成功；仍可见则继续走 ESC 兜底。
      if (!await findVisibleDouyinAdPopup(page)) {
        isDouyinAdPopupDismissed("明确关闭入口点击后弹层已消失");
        return true;
      }
      log("主线:诊断", "弹窗治理", "广告弹窗关闭入口点击失败", `抖音，原因=${String(error?.message || error).slice(0, 160)}`);
    }
    if (await waitForAdPopupGone(page)) {
      isDouyinAdPopupDismissed("已点击明确关闭入口");
      return true;
    }
  }
  // 抖音活动弹窗常无显式关闭按钮（只有促销 CTA），此时按项目既有做法用 ESC 收起面板；
  // 这里绝不点促销按钮，避免把页面导航到活动页。
  await page.keyboard.press("Escape");
  if (await waitForAdPopupGone(page)) {
    isDouyinAdPopupDismissed("无显式关闭入口，已用 ESC 收起");
    return true;
  }
  log("主线:诊断", "弹窗治理", "抖音广告弹窗仍未消失", "已尝试唯一关闭入口与 ESC，本轮不再继续猜测点击");
  return false;
}

function isPointerInterceptedError(error) {
  // 该函数只识别“元素可见但被其它层拦截点击”这一类真实遮挡错误。
  return /intercepts pointer events/i.test(String(error?.message || error || ""));
}

module.exports = {
  DOUYIN_AD_POPUP_SELECTORS,
  findVisibleDouyinAdPopup,
  dismissDouyinAdPopup,
  isPointerInterceptedError
};
