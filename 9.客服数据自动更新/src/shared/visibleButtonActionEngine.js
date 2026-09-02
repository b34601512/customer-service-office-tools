const {
  clickLocatorWhenReady,
  readLocatorActionabilityState,
  wait,
  waitForLocatorActionable
} = require("./browserActionEngine");

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleExactTextPattern(text) {
  // 这里允许按钮文案被样式拆成“导 出”这类形态，同时仍然保持精确匹配。
  const normalizedText = String(text || "").replace(/\s+/g, "");
  const body = Array.from(normalizedText)
    .map((char) => escapeRegex(char))
    .join("\\s*");
  return new RegExp(`^\\s*${body}\\s*$`, "i");
}

function buildButtonTextPattern(textList) {
  // 这里把平台传入的按钮文案合并成统一匹配规则，底层不硬编码任何平台文案。
  const variants = (textList || [])
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .map((text) => buildFlexibleExactTextPattern(text).source.replace(/^\^\\s\*/, "").replace(/\\s\*\$$/, ""));

  if (!variants.length) {
    throw new Error("按钮文本模式不能为空。");
  }

  return new RegExp(`^\\s*(?:${variants.join("|")})\\s*$`, "i");
}

function buildTextButtonLocator(surface, textList, options = {}) {
  // 这里统一从按钮、链接和 role=button 中按平台文案找目标按钮。
  const selector = String(options.selector || "button, a, [role='button']").trim();
  return surface
    .locator(selector)
    .filter({ hasText: buildButtonTextPattern(textList) })
    .first();
}

function collectVisibleButtonSurfaces(page, surface, browser = null) {
  // 这里统一跨 page/frame 收集操作面，避免动态页面刷新后还拿旧 frame 找按钮。
  const surfaceEntries = [];
  const seen = new Set();
  const pushSurface = (ownerPage, candidate) => {
    if (!candidate || seen.has(candidate)) {
      return;
    }

    seen.add(candidate);
    surfaceEntries.push({
      page: ownerPage || (typeof candidate.page === "function" ? candidate.page() : page),
      surface: candidate
    });
  };

  pushSurface(page, page);
  if (page && typeof page.frames === "function") {
    page.frames().forEach((frame) => pushSurface(page, frame));
  }

  if (browser && typeof browser.contexts === "function") {
    for (const context of browser.contexts()) {
      for (const candidatePage of context.pages()) {
        pushSurface(candidatePage, candidatePage);
        if (typeof candidatePage.frames === "function") {
          candidatePage.frames().forEach((frame) => pushSurface(candidatePage, frame));
        }
      }
    }
  }
  pushSurface(page, surface);

  return surfaceEntries;
}

function buildButtonLocatorsForSurface(surface, options = {}) {
  // 这里允许平台补充特殊 selector，但默认仍使用统一文本按钮定位。
  const locators = [];
  if (typeof options.buildLocators === "function") {
    const customLocators = options.buildLocators(surface) || [];
    locators.push(...customLocators.filter(Boolean));
  }
  if (Array.isArray(options.textList) && options.textList.length) {
    locators.push(buildTextButtonLocator(surface, options.textList, options));
  }
  return locators;
}

async function describeVisibleButton(locator) {
  // 这里记录被点击按钮的真实 DOM 信息，方便排查“点错按钮”和“按钮不可见”。
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      text: String(element.innerText || element.textContent || element.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim(),
      className: String(element.className || ""),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  });
}

async function readVisibleButtonTexts(surface) {
  // 这里在失败时列出页面真实可见按钮，避免继续靠猜 selector。
  return surface.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    return Array.from(document.querySelectorAll("button, a, [role='button']"))
      .filter((element) => isVisible(element))
      .map((element) => normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label") || ""))
      .filter(Boolean)
      .slice(0, 30);
  });
}

async function readVisibleButtonTextsFromSurfaces(surfaceEntries) {
  // 这里把多个 page/frame 的可见按钮合并去重，专门服务失败诊断。
  const texts = [];
  const seen = new Set();
  for (const entry of surfaceEntries || []) {
    for (const text of await readVisibleButtonTexts(entry.surface)) {
      if (!seen.has(text)) {
        seen.add(text);
        texts.push(text);
      }
    }
  }
  return texts;
}

async function findVisibleButtonTarget(options = {}) {
  // 这里只负责找候选按钮，不判断最终可点击，让等待层统一处理“出现但暂不可点”的状态。
  const surfaceEntries =
    options.surfaceEntries || collectVisibleButtonSurfaces(options.page, options.surface, options.browser || null);
  let fallbackTarget = null;
  for (const candidateSurface of surfaceEntries) {
    for (const locator of buildButtonLocatorsForSurface(candidateSurface.surface, options)) {
      const state = await readLocatorActionabilityState(locator);
      if (state?.count > 0) {
        const target = {
          locator,
          state,
          page: candidateSurface.page,
          surface: candidateSurface.surface
        };
        if (state.visible && !state.disabled) {
          return target;
        }
        if (!fallbackTarget) {
          fallbackTarget = target;
        }
      }
    }
  }

  return fallbackTarget;
}

async function waitForVisibleButtonTarget(options = {}) {
  // 这里按“重新扫描当前 page/frame -> 等按钮可操作”的方式找按钮，兼容动态重渲染页面。
  const safeTimeoutMs = Math.max(1, Number(options.timeoutMs) || 15000);
  const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs) || 200);
  const actionName = String(options.actionName || "按钮").trim() || "按钮";
  const startAt = Date.now();
  const deadline = startAt + safeTimeoutMs;
  const fixedSurfaceEntries = options.surfaceEntries || null;
  let lastSurfaceEntries = fixedSurfaceEntries || [];
  let lastState = null;
  let lastActionError = null;

  while (Date.now() <= deadline) {
    const surfaceEntries =
      fixedSurfaceEntries || collectVisibleButtonSurfaces(options.page, options.surface, options.browser || null);
    lastSurfaceEntries = surfaceEntries;
    const matched = await findVisibleButtonTarget({
      ...options,
      surfaceEntries
    });
    if (matched) {
      lastState = matched.state;
      try {
        const locator = await waitForLocatorActionable(matched.locator, actionName, {
          ...(options.actionOptions || {}),
          timeoutMs: Math.max(1, Math.min(1000, deadline - Date.now()))
        });
        return {
          ...matched,
          locator
        };
      } catch (error) {
        lastActionError = error instanceof Error ? error : new Error(String(error));
      }
    }

    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }

  const visibleButtonTexts = await readVisibleButtonTextsFromSurfaces(lastSurfaceEntries);
  const stateText = lastState ? `最后状态=${JSON.stringify(lastState)}` : "没有定位到目标元素";
  const actionText = lastActionError ? `，最后可操作检测=${lastActionError.message}` : "";
  const visibleText = visibleButtonTexts.length ? `，当前可见按钮=${visibleButtonTexts.join(" / ")}` : "";
  throw new Error(`等待「${actionName}」可操作超时：已等待${Date.now() - startAt}ms，${stateText}${actionText}${visibleText}`);
}

async function clickVisibleButton(options = {}) {
  // 这里统一执行“找按钮、确认可点、点击、记录目标”，平台只需要传按钮文案和特殊候选定位。
  const target = await waitForVisibleButtonTarget(options);
  const clickedLocator = await clickLocatorWhenReady(target.locator, options.clickActionName || options.actionName || "按钮", {
    ...(options.actionOptions || {}),
    timeoutMs: Math.max(1, Number(options.clickTimeoutMs) || 5000)
  });
  return {
    ...target,
    locator: clickedLocator,
    description: await describeVisibleButton(clickedLocator)
  };
}

module.exports = {
  escapeRegex,
  buildFlexibleExactTextPattern,
  buildButtonTextPattern,
  collectVisibleButtonSurfaces,
  findVisibleButtonTarget,
  waitForVisibleButtonTarget,
  clickVisibleButton
};
