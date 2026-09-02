const fs = require("fs");
const path = require("path");
const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");

const refreshedSecurityNoticePages = new WeakSet();

function buildTmallCheckpointPath(checkpointLabel, extension) {
  // 该函数只生成不会覆盖旧现场的页面凭证路径。
  const capturedAt = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
  const safeLabel = String(checkpointLabel || "天猫页面").replace(/[\\/:*?"<>|\s]+/g, "-");
  const directory = path.join(appConfig.runtime.cache.snapshots.tmall, "checkpoints");
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, `${capturedAt}-${safeLabel}.${extension}`);
}

async function captureTmallPageCheckpoint(page, checkpointLabel) {
  // 该函数只保存当前页面地址和截图，不扫描或猜测页面元素。
  if (typeof page?.screenshot !== "function") {
    return null;
  }
  const metadataPath = buildTmallCheckpointPath(checkpointLabel, "json");
  const screenshotPath = metadataPath.replace(/\.json$/i, ".png");
  const pageUrl = typeof page.url === "function" ? page.url() : "";
  fs.writeFileSync(metadataPath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    checkpoint: String(checkpointLabel || "天猫页面"),
    pageUrl
  }, null, 2), "utf8");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  log("主线:完成", "天猫取证", "页面现场", `阶段=${checkpointLabel}，截图=${screenshotPath}`);
  return { metadataPath, screenshotPath };
}

async function hasVisibleTmallText(page, pattern) {
  // 该函数只判断一类明确文案是否至少有一个可见实例。
  const locator = page.getByText(pattern);
  const matchCount = await locator.count();
  for (let index = 0; index < matchCount; index += 1) {
    if (await locator.nth(index).isVisible()) {
      return true;
    }
  }
  return false;
}

async function detectTmallSafetyChallenge(page) {
  // 该函数只读取明确可见的安全信号，不在页面跳转期间抓取整页正文。
  const securityHeadingVisible = await hasVisibleTmallText(page, /安全提示/);
  const securityReasonVisible = securityHeadingVisible && await hasVisibleTmallText(
    page,
    /异常访问行为|高频|脚本访问|安全机制|限制访问/
  );
  if (securityReasonVisible) {
    return { type: "security_notice", text: "页面出现异常访问安全提示" };
  }
  const sliderVisible = await hasVisibleTmallText(
    page,
    /拖动.*滑块.*完成验证|通过验证以确保正常访问|滑块完成验证/
  );
  if (sliderVisible) {
    return { type: "slider_verification", text: "页面出现滑块验证" };
  }
  return { type: "none", text: "" };
}

async function stopForTmallSafetyChallenge(page, phase, result) {
  // 该函数只留存无法自动恢复的天猫安全现场并停止。
  await captureTmallPageCheckpoint(page, `安全提示-${phase}`);
  log("主线:失败", "天猫风控", phase, `检测到${result.type}，摘要=${result.text || "未读取到正文"}`);
  throw new Error(`天猫需要人工处理安全提示：${phase}。当前流程已停止，未关闭或猜测点击。`);
}

async function refreshTmallSecurityNoticeOnce(page, phase, result) {
  // 该函数只对已确认的安全提示刷新一次并回到原步骤。
  if (refreshedSecurityNoticePages.has(page)) {
    await stopForTmallSafetyChallenge(page, phase, result);
  }
  refreshedSecurityNoticePages.add(page);
  await captureTmallPageCheckpoint(page, `安全提示刷新前-${phase}`);
  log("主线:提示", "天猫风控", phase, "检测到已确认安全提示，刷新一次后回到原步骤");
  await page.reload({ waitUntil: "domcontentloaded", timeout: appConfig.tmall.connectTimeoutMs });
  const refreshedResult = await detectTmallSafetyChallenge(page);
  if (refreshedResult.type !== "none") {
    await stopForTmallSafetyChallenge(page, `${phase}-刷新后`, refreshedResult);
  }
  log("主线:完成", "天猫风控", phase, "安全提示刷新后已消失，继续原步骤");
  return true;
}

async function assertNoTmallSafetyChallenge(page, phaseText) {
  // 该函数只让已确认安全提示刷新一次；滑块和其他安全阻断一律停止。
  const result = await detectTmallSafetyChallenge(page);
  if (result.type === "none") {
    return false;
  }
  const phase = String(phaseText || "天猫页面操作").trim();
  if (result.type === "security_notice") {
    return refreshTmallSecurityNoticeOnce(page, phase, result);
  }
  return stopForTmallSafetyChallenge(page, phase, result);
}

module.exports = {
  assertNoTmallSafetyChallenge,
  captureTmallPageCheckpoint
};
