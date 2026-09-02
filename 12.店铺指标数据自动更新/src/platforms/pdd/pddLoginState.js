const appConfig = require("../../config/appConfig");
const { tryAutofillPddLoginFrame } = require("./pddLoginLocators");
const { isPddPageLoadingText, readPddPageBodyText } = require("./pddPageText");
const { isPddStoreIdentityMatched } = require("./pddStoreIdentity");
const { detectManualVerificationReason } = require("../manualVerificationShared");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPddBusinessUrl(url) {
  return /mms\.pinduoduo\.com/i.test(String(url || ""));
}

function isPddLoginUrl(url) {
  return /(?:mms|login|passport|auth)\.pinduoduo\.com/i.test(String(url || "")) ||
    /pinduoduo\.com\/login/i.test(String(url || ""));
}

function hasPddLoginFormText(text) {
  const normalizedText = normalizeText(text);
  return ["手机号登录", "账号登录", "扫码登录", "请输入手机号", "请输入账号", "请输入密码", "登录拼多多", "立即登录"]
    .some((keyword) => normalizedText.includes(keyword));
}

function hasPddMetricText(text) {
  const normalizedText = normalizeText(text);
  return ["3分钟人工回复率", "纠纷退款率", "店铺综合体验星级", "综合体验星级"]
    .some((keyword) => normalizedText.includes(keyword));
}

function detectPddManualVerificationReason(text, pageUrl = "") {
  return detectManualVerificationReason(text, pageUrl);
}

function findBestPddPage(browser, storeConfig = {}) {
  const targetUrl = String(storeConfig.siteUrl || "").trim();
  const candidates = [];
  for (const context of browser?.contexts?.() || []) {
    for (const page of context.pages()) {
      const url = String(page.url?.() || "");
      if (!isPddLoginUrl(url)) continue;
      const score = (targetUrl && url.startsWith(targetUrl) ? 40 : 0) +
        (isPddBusinessUrl(url) ? 20 : 0) + (hasPddMetricText(page.__lastPddBodyText || "") ? 10 : 0);
      candidates.push({ page, score });
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0]?.page || null;
}

async function isPddMetricPageReady(page, storeConfig = {}) {
  if (!page || !isPddBusinessUrl(page.url())) return false;
  const bodyText = await readPddPageBodyText(page).catch(() => "");
  page.__lastPddBodyText = bodyText;
  if (!bodyText || isPddPageLoadingText(bodyText) || hasPddLoginFormText(bodyText)) return false;
  if (!hasPddMetricText(bodyText)) return false;
  return isPddStoreIdentityMatched(bodyText, storeConfig);
}

async function waitForPddLoginReady(browser, storeConfig = {}, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || appConfig.pdd.connectTimeoutMs));
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs || appConfig.pdd.loginReadyPollIntervalMs));
  const deadline = Date.now() + timeoutMs;
  const autofilledFrames = new WeakSet();
  let reportedVerificationReason = "";
  let submitted = false;
  while (Date.now() <= deadline) {
    const pages = (browser?.contexts?.() || []).flatMap((context) => context.pages());
    for (const page of pages) {
      const pageUrl = String(page.url?.() || "");
      if (!isPddLoginUrl(pageUrl)) continue;
      const bodyText = await readPddPageBodyText(page).catch(() => "");
      page.__lastPddBodyText = bodyText;
      if (await isPddMetricPageReady(page, storeConfig)) return page;

      const verificationReason = detectPddManualVerificationReason(bodyText, pageUrl);
      if (verificationReason && verificationReason !== reportedVerificationReason) {
        reportedVerificationReason = verificationReason;
        if (typeof options.onManualVerification === "function") options.onManualVerification(verificationReason);
      }

      for (const frame of [page, ...(page.frames?.() || [])]) {
        if (autofilledFrames.has(frame)) continue;
        const fillResult = await tryAutofillPddLoginFrame(
          frame,
          { username: storeConfig.username, password: storeConfig.password }
        ).catch(() => ({ filled: false, switched: false }));
        if (fillResult.filled) {
          autofilledFrames.add(frame);
          submitted = true;
          if (typeof options.onLoginSubmitted === "function") options.onLoginSubmitted();
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))));
  }
  const suffix = reportedVerificationReason ? `，仍在等待${reportedVerificationReason}` : "";
  throw new Error(`等待拼多多登录成功超时${suffix}${submitted ? "；账号密码已提交，请完成验证后重试" : ""}。`);
}

module.exports = {
  isPddBusinessUrl,
  isPddLoginUrl,
  hasPddLoginFormText,
  hasPddMetricText,
  detectPddManualVerificationReason,
  findBestPddPage,
  isPddMetricPageReady,
  waitForPddLoginReady
};
