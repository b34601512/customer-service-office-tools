const { log } = require("../engine/logger");

const DEFAULT_DIALOG_SELECTORS = [
  "[role='dialog']",
  "[aria-modal='true']",
  "#msg_box_modal",
  "[role='tooltip'].auxo-tooltip-inner:has(.auxo-dorami-guide-single-content-wrapper)"
];
const DEFAULT_CLOSE_SELECTORS = [
  "[aria-label='Close' i]",
  "[aria-label*='close' i]",
  "[aria-label='关闭']",
  "[title='关闭']",
  "[title*='关闭']",
  "[data-testid*='close' i]",
  "[data-e2e*='close' i]",
  "[data-qa*='close' i]",
  "[data-action='close' i]",
  ".auxo-modal-close",
  ".ant-modal-close",
  ".el-dialog__headerbtn",
  "img[class*='other_close__']",
  "[class*='close' i]",
  ".close",
  ".Close"
];
const DEFAULT_CLOSE_TEXTS = ["关闭", "取消", "知道了"];
const DEFAULT_POPUP_POLL_INTERVAL_MS = 100;
const DEFAULT_POPUP_TRANSITION_TIMEOUT_MS = 5000;

function buildVisibleSelector(selectors) {
  // 该函数只把多个候选结构限制为当前可见元素。
  return selectors.map((selector) => `${selector}:visible`).join(", ");
}

function buildExactTextPattern(texts) {
  // 该函数只生成明确关闭文案的精确匹配规则。
  const escapedTexts = texts
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*(?:${escapedTexts.join("|")})\\s*$`);
}

function buildPopupFailure(platformName, reason) {
  // 该函数只生成停止而不猜点时的统一错误信息。
  return new Error(`关闭${platformName}遮挡弹窗失败：${reason}。流程已停止，未点击其他按钮。`);
}

function normalizePopupSignatureValue(value) {
  // 该函数只把弹窗结构证据压缩成可比较文本。
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readPopupSignature(popupElementHandle) {
  // 该函数只读取当前这一个真实弹层节点的稳定签名。
  return popupElementHandle.evaluate((element) => ({
    className: String(element.className || ""),
    text: String(element.innerText || "").replace(/\s+/g, " ").trim(),
    visible: (() => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return element.isConnected &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;
    })()
  }));
}

function hasPopupSignatureAdvanced(currentSignature, originalSignature) {
  // 该函数只判断刚才点击的弹层已消失或已切换到下一层内容。
  if (!currentSignature?.visible) {
    return true;
  }
  return normalizePopupSignatureValue(currentSignature.className) !== normalizePopupSignatureValue(originalSignature.className) ||
    normalizePopupSignatureValue(currentSignature.text) !== normalizePopupSignatureValue(originalSignature.text);
}

async function waitForPopupTransition(surface, popupElementHandle, originalSignature, options) {
  // 该函数只等待刚才操作的真实节点消失或内容推进，避免宽泛定位器串到下一层。
  const timeoutMs = Number(options.popupTransitionTimeoutMs) || DEFAULT_POPUP_TRANSITION_TIMEOUT_MS;
  const pollIntervalMs = Number(options.popupPollIntervalMs) || DEFAULT_POPUP_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    try {
      const currentSignature = await readPopupSignature(popupElementHandle);
      if (hasPopupSignatureAdvanced(currentSignature, originalSignature)) {
        return;
      }
    } catch (_error) {
      // 节点已被页面移除时，ElementHandle 读取会失败，这正是关闭成功。
      return;
    }
    await surface.waitForTimeout(pollIntervalMs);
  }
  throw buildPopupFailure(options.platformName, "点击明确关闭入口后，原弹层既未消失也未进入下一层");
}

async function findOnlyVisiblePopup(surface, options) {
  // 该函数只确认当前操作面存在唯一遮挡弹窗。
  const dialogSelectors = options.dialogSelectors || DEFAULT_DIALOG_SELECTORS;
  const visiblePopups = surface.locator(buildVisibleSelector(dialogSelectors));
  const popupCount = await visiblePopups.count();
  if (popupCount === 0) {
    return null;
  }
  if (popupCount !== 1) {
    throw buildPopupFailure(options.platformName, `检测到${popupCount}个可见弹窗，无法确认当前遮挡层`);
  }
  return visiblePopups.first();
}

async function logPopupDiagnostics(popup, closeSelectors, platformName, reason) {
  // 该函数只记录未知弹窗的结构证据，供下一次按规律扩展通用关闭入口。
  try {
    const diagnosticPayload = await popup.evaluate((rootElement, selectors) => {
      const result = { dialog: {}, closeCandidates: [], candidatesText: [] };
      const dialogClassName = String(rootElement.className || "");
      const dialogRole = rootElement.getAttribute("role") || "";
      const dialogAriaModal = rootElement.getAttribute("aria-modal") || "";
      const dialogHtml = String(rootElement.outerHTML || "").slice(0, 1200);
      result.dialog = { className: dialogClassName, role: dialogRole, ariaModal: dialogAriaModal, html: dialogHtml };
      for (const selector of selectors) {
        Array.from(rootElement.querySelectorAll(selector)).forEach((element) => {
          if (element.offsetWidth <= 0) return;
          result.closeCandidates.push({
            selector,
            tag: element.tagName.toLowerCase(),
            className: String(element.className || ""),
            ariaLabel: element.getAttribute("aria-label") || "",
            text: String(element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
            html: String(element.outerHTML || "").slice(0, 500)
          });
        });
      }
      Array.from(rootElement.querySelectorAll("button, a, [role='button']")).forEach((element) => {
        const text = String(element.innerText || "").replace(/\s+/g, " ").trim();
        if (text && /(关闭|取消|知道了)/.test(text) && element.offsetWidth > 0) {
          result.candidatesText.push({
            tag: element.tagName.toLowerCase(),
            className: String(element.className || ""),
            text: text.slice(0, 40),
            html: String(element.outerHTML || "").slice(0, 400)
          });
        }
      });
      return result;
    }, closeSelectors);
    log(
      "主线:诊断",
      "弹窗治理",
      "未知弹窗现场",
      `平台=${platformName}，原因=${reason}，${JSON.stringify(diagnosticPayload)}`
    );
  } catch (diagnoseError) {
    log("主线:诊断", "弹窗治理", "未知弹窗现场采集失败", `平台=${platformName}，原因=${reason}，${String(diagnoseError?.message || diagnoseError)}`);
  }
}

async function findOnlyExplicitCloseTarget(popup, options) {
  // 该函数只在当前弹窗内寻找唯一、明确的关闭入口。
  const closeSelectors = options.closeSelectors || DEFAULT_CLOSE_SELECTORS;
  const semanticCloseTargets = popup.locator(buildVisibleSelector(closeSelectors));
  const semanticCloseCount = await semanticCloseTargets.count();
  if (semanticCloseCount === 1) {
    return semanticCloseTargets.first();
  }
  if (semanticCloseCount > 1) {
    // 常见弹窗规律：关闭按钮内嵌带 aria-label 的图标 span，会同时命中多个语义关闭候选。
    // 这里先按“最外层不被其它候选包含”的规则去重，仍唯一且可点击才选中，绝不猜测点击。
    const containerInfo = await semanticCloseTargets
      .evaluateAll((elements) => elements.map((element, index) => {
        const containedBy = elements.find((other, otherIndex) => otherIndex !== index && other.contains(element));
        return {
          index,
          tag: element.tagName.toLowerCase(),
          className: String(element.className || ""),
          ariaLabel: element.getAttribute("aria-label") || "",
          clickable: element.tagName.toLowerCase() === "button" ||
            element.tagName.toLowerCase() === "a" ||
            element.getAttribute("role") === "button",
          containedByIndex: containedBy ? elements.indexOf(containedBy) : -1
        };
      }))
      .catch(() => null);

    if (Array.isArray(containerInfo)) {
      const outermostTargets = containerInfo.filter((item) => item.containedByIndex === -1);
      if (outermostTargets.length === 1 && outermostTargets[0].clickable) {
        log(
          "主线:完成",
          "弹窗治理",
          "嵌套关闭去重",
          `平台=${options.platformName}，共${semanticCloseCount}个语义候选，已按最外层选中 ${outermostTargets[0].tag}.${outermostTargets[0].className}`
        );
        return semanticCloseTargets.nth(outermostTargets[0].index);
      }
    }

    await logPopupDiagnostics(popup, closeSelectors, options.platformName, `检测到${semanticCloseCount}个明确关闭入口`);
    throw buildPopupFailure(options.platformName, `检测到${semanticCloseCount}个明确关闭入口，无法安全选择`);
  }

  const closeTexts = options.closeTexts || DEFAULT_CLOSE_TEXTS;
  const textCloseTargets = popup
    .locator("button:visible, a:visible, [role='button']:visible")
    .filter({ hasText: buildExactTextPattern(closeTexts) });
  const textCloseCount = await textCloseTargets.count();
  if (textCloseCount === 1) {
    return textCloseTargets.first();
  }
  if (textCloseCount > 1) {
    await logPopupDiagnostics(popup, closeSelectors, options.platformName, `检测到${textCloseCount}个关闭文案入口`);
    throw buildPopupFailure(options.platformName, `检测到${textCloseCount}个关闭文案入口，无法安全选择`);
  }
  await logPopupDiagnostics(popup, closeSelectors, options.platformName, "未找到唯一明确关闭入口");
  throw buildPopupFailure(options.platformName, "未找到唯一明确关闭入口");
}

async function dismissBlockingPopups(surface, options = {}) {
  // 该函数只循环关闭当前操作面中唯一、明确的遮挡弹窗，并等待异步晚到弹层稳定。
  const platformName = String(options.platformName || "当前页面").trim() || "当前页面";
  const resolvedOptions = { ...options, platformName };
  const idleTimeoutMs = Math.max(0, Number(options.popupIdleTimeoutMs) || 0);
  const pollIntervalMs = Number(options.popupPollIntervalMs) || DEFAULT_POPUP_POLL_INTERVAL_MS;
  let closedPopupCount = 0;
  let idleDeadline = Date.now() + idleTimeoutMs;

  while (true) {
    const popup = await findOnlyVisiblePopup(surface, resolvedOptions);
    if (!popup) {
      if (Date.now() >= idleDeadline) {
        return closedPopupCount;
      }
      await surface.waitForTimeout(pollIntervalMs);
      continue;
    }

    const closeTarget = await findOnlyExplicitCloseTarget(popup, resolvedOptions);
    const popupElementHandle = await popup.elementHandle();
    if (!popupElementHandle) {
      throw buildPopupFailure(platformName, "当前可见弹层在操作前已经失效");
    }
    try {
      const originalSignature = await readPopupSignature(popupElementHandle);
      try {
        await closeTarget.click({ timeout: 5000 });
      } catch (clickError) {
        // 弹窗动画切换时，按钮可能刚被页面移除或隐藏；重新确认当前操作面。
        // 只有确认原弹窗已消失，才把这次竞态视为关闭成功，绝不吞掉仍可见的真实弹窗错误。
        const remainingPopup = await findOnlyVisiblePopup(surface, resolvedOptions);
        if (remainingPopup) {
          throw clickError;
        }
        log(
          "主线:完成",
          "弹窗治理",
          "关闭竞态收敛",
          `平台=${platformName}，明确关闭入口在点击时已随弹层消失`
        );
        closedPopupCount += 1;
        idleDeadline = Date.now() + idleTimeoutMs;
        continue;
      }
      await waitForPopupTransition(surface, popupElementHandle, originalSignature, resolvedOptions);
    } finally {
      await popupElementHandle.dispose().catch(() => {});
    }
    closedPopupCount += 1;
    idleDeadline = Date.now() + idleTimeoutMs;
    log("主线:完成", "弹窗治理", "关闭遮挡弹窗", `平台=${platformName}，已关闭=${closedPopupCount}`);
  }
}

async function runAfterDismissingBlockingPopups(surface, action, options = {}) {
  // 该函数只在安全治理弹窗后执行一次动作，并在真实弹窗抢先出现时最多恢复重试一次。
  await dismissBlockingPopups(surface, options);
  try {
    return await action();
  } catch (firstError) {
    const recoveredPopupCount = await dismissBlockingPopups(surface, {
      ...options,
      popupIdleTimeoutMs: 0
    });
    if (recoveredPopupCount === 0) {
      throw firstError;
    }
    return action();
  }
}

module.exports = {
  dismissBlockingPopups,
  runAfterDismissingBlockingPopups
};
