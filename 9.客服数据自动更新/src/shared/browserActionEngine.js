const { log } = require("../engine/logger");

const DEFAULT_ACTION_TIMEOUT_MS = 15000;
const DEFAULT_ACTION_POLL_INTERVAL_MS = 100;
const PLATFORM_SAFE_ACTION_POLL_INTERVAL_MS = 700;
const PLATFORM_SAFE_CLICK_INTERVAL_MS = 1200;
let lastCommittedClickAt = 0;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveNow(options = {}) {
  const nowFn = typeof options.nowFn === "function" ? options.nowFn : Date.now;
  return Number(nowFn()) || Date.now();
}

async function waitForClickCadence(actionName, options = {}) {
  // 这里统一限制连续真实点击的节奏，避免平台把短时间密集操作识别成脚本行为。
  const platformDefaults = inferPlatformSafeActionOptions(actionName);
  const minimumClickIntervalMs = Math.max(
    0,
    Number(resolveOptionWithPlatformDefault(options, platformDefaults, "minimumClickIntervalMs", 0)) || 0
  );
  if (!minimumClickIntervalMs || !lastCommittedClickAt) {
    return;
  }

  const now = resolveNow(options);
  const elapsedMs = Math.max(0, now - lastCommittedClickAt);
  const waitMs = minimumClickIntervalMs - elapsedMs;
  if (waitMs <= 0) {
    return;
  }

  if (options.shouldLogThrottle !== false) {
    log("主线:等待", "浏览器动作", "点击节流", `动作=${actionName}，等待=${waitMs}ms`);
  }

  const waitFn = typeof options.waitFn === "function" ? options.waitFn : wait;
  await waitFn(waitMs);
}

function rememberCommittedClick(options = {}) {
  lastCommittedClickAt = resolveNow(options);
}

function inferPlatformSafeActionOptions(actionName) {
  // 这里给三大平台的真实页面操作默认套上慢节奏，避免遗漏某个调用点后又变成高频点击。
  return /天猫|京东|拼多多/.test(String(actionName || ""))
    ? {
        pollIntervalMs: PLATFORM_SAFE_ACTION_POLL_INTERVAL_MS,
        minimumClickIntervalMs: PLATFORM_SAFE_CLICK_INTERVAL_MS,
        requireTrialClick: false
      }
    : {};
}

function resolveOptionWithPlatformDefault(options, platformDefaults, key, fallbackValue) {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    return options[key];
  }

  if (Object.prototype.hasOwnProperty.call(platformDefaults, key)) {
    return platformDefaults[key];
  }

  return fallbackValue;
}

function isLocatorActionableState(state) {
  return Boolean(state?.count > 0 && state?.visible && !state?.disabled);
}

function describeLocatorActionabilityState(state) {
  if (!state?.count) {
    return "还没有定位到目标元素";
  }

  if (!state.visible) {
    return "目标元素还不可见";
  }

  if (state.disabled) {
    return "目标元素仍处于禁用状态";
  }

  return "目标元素状态仍未稳定";
}

async function readLocatorActionabilityState(locator) {
  const count = await locator.count();
  if (!count) {
    return {
      count: 0,
      visible: false,
      disabled: false
    };
  }

  return {
    count,
    visible: await locator.isVisible(),
    disabled: await locator.isDisabled()
  };
}

async function waitForLocatorActionable(locator, actionName, options = {}) {
  // 这里统一等待浏览器控件真正进入可操作状态，避免电脑卡顿时“看见了但还不能点”。
  const platformDefaults = inferPlatformSafeActionOptions(actionName);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_ACTION_TIMEOUT_MS);
  const pollIntervalMs = Math.max(
    20,
    Number(resolveOptionWithPlatformDefault(options, platformDefaults, "pollIntervalMs", DEFAULT_ACTION_POLL_INTERVAL_MS)) ||
      DEFAULT_ACTION_POLL_INTERVAL_MS
  );
  const requireTrialClick = Boolean(
    resolveOptionWithPlatformDefault(options, platformDefaults, "requireTrialClick", true)
  );
  const deadline = Date.now() + timeoutMs;
  let lastState = { count: 0, visible: false, disabled: false };
  let lastTrialError = null;

  while (Date.now() <= deadline) {
    lastState = await readLocatorActionabilityState(locator);
    if (isLocatorActionableState(lastState)) {
      try {
        await locator.scrollIntoViewIfNeeded();
        if (requireTrialClick) {
          await locator.click({
            trial: true,
            timeout: Math.max(1, Math.min(1500, deadline - Date.now()))
          });
        }
        return locator;
      } catch (error) {
        lastTrialError = error instanceof Error ? error : new Error(String(error));
      }
    }

    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }

  const suffix = lastTrialError ? `，最后一次试点失败：${lastTrialError.message}` : "";
  throw new Error(`等待「${actionName}」可操作超时：${describeLocatorActionabilityState(lastState)}${suffix}`);
}

async function clickLocatorWhenReady(locator, actionName, options = {}) {
  // 这里统一收口“先等状态、再点击”，让各平台都按同一套交互纪律执行。
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_ACTION_TIMEOUT_MS);
  const actionableLocator = await waitForLocatorActionable(locator, actionName, {
    ...options,
    timeoutMs
  });

  try {
    await waitForClickCadence(actionName, options);
    await actionableLocator.click({ timeout: timeoutMs });
    rememberCommittedClick(options);
    return actionableLocator;
  } catch (error) {
    throw new Error(`点击${actionName}失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

module.exports = {
  wait,
  readLocatorActionabilityState,
  waitForLocatorActionable,
  clickLocatorWhenReady
};
