// #664 的独立只读诊断，不接入正式采集、任务历史或写表流程。
// 复用用户明确允许连接的 Chrome；不启动浏览器、不刷新页面、不读取 Cookie。
const { chromium } = require("playwright-core");
const { extractMetricFromText } = require("../src/platforms/jd/storeMetrics/jdMetricText");
const { resolveShopStarPageDataDate } = require("../src/platforms/jd/storeMetrics/jdShopStarMetricCollector");

function isJdPage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && (url.hostname === "jd.com" || url.hostname.endsWith(".jd.com"));
  } catch {
    return false;
  }
}

function summarizeDisplayedMetrics(pageText, expectedShop) {
  const text = String(pageText || "").replace(/\s+/g, " ").trim();
  if (!text.includes(expectedShop)) {
    throw new Error("当前星级页未显示指定店名，未将页面数据归到该店，也未切换账号。");
  }
  // 仅列出诊断所需的页面显示值；不是另一套生产指标映射。
  const metrics = [
    ["咚咚平均响应时长", "秒"],
    ["售后服务时长", "小时"],
    ["店铺评价得分", "分"]
  ].map(([name, unit]) => {
    const offset = text.indexOf(name);
    return {
      name,
      unit,
      displayedValue: extractMetricFromText(text, name, unit),
      // 解析不到时保留短片段供人工对照，不将缺失值伪装成页面上的0。
      evidence: offset < 0 ? "" : text.slice(offset, offset + 100)
    };
  });
  const dataDate = resolveShopStarPageDataDate(text);
  return {
    expectedShop,
    shopNameVisible: true,
    dataDate: dataDate || null,
    metrics,
    status: dataDate && metrics.filter((metric) => metric.displayedValue !== null).length >= 2
      ? "snapshot-read" : "needs-inspection",
    limitation: "只证明当前页面显示内容，尚未验证刷新后接口、跨店批量采集或正式表格。"
  };
}

async function inspectJdMainChrome(expectedShop, browserType = chromium) {
  if (!String(expectedShop || "").trim()) throw new Error("请指定要核对的完整店名。");
  // noDefaults 避免向用户浏览器施加默认的下载、焦点等自动化设置。
  // 官方现有会话连接需要 Chrome 144+、主动启用及用户批准；失败直接结束。
  const browser = await browserType.connectOverCDP("chrome", { timeout: 30000, noDefaults: true });
  try {
    const candidates = [];
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!isJdPage(page.url())) continue;
        const title = await page.title();
        if (/星级|店铺体验/.test(title)) candidates.push({ page, title });
      }
    }
    if (candidates.length !== 1) {
      throw new Error(`找到${candidates.length}个京东星级标签页；请仅保留一个待核对星级页，本次未操作任何标签页。`);
    }
    const { page, title } = candidates[0];
    const texts = [];
    for (const frame of page.frames()) {
      if (!isJdPage(frame.url())) continue;
      const text = await frame.locator("body").innerText({ timeout: 5000 });
      if (!isJdPage(frame.url()) || !isJdPage(page.url())) {
        throw new Error("读取期间页面已离开京东，未输出页面内容。");
      }
      texts.push(text);
    }
    return { browserVersion: browser.version(), title, ...summarizeDisplayedMetrics(texts.join("\n"), expectedShop.trim()) };
  } finally {
    // Playwright 的 CDP 附着模式中 close 只断开本连接，不退出用户 Chrome。
    // 不调用 page.close/context.close，也不接入项目的 managedChrome 生命周期。
    await browser.close();
  }
}

if (require.main === module) {
  inspectJdMainChrome(process.argv[2]).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "snapshot-read") process.exitCode = 2;
  }).catch((error) => {
    console.error(`只读验证未完成：${String(error.message).split("\n")[0]}`);
    console.error("连接前提：Chrome 144+；用户在 chrome://inspect/#remote-debugging 开启连接并批准弹窗。");
    console.error("未写入正式表，未启动独立浏览器，未关闭用户 Chrome。");
    process.exitCode = 1;
  });
}

module.exports = { isJdPage, summarizeDisplayedMetrics, inspectJdMainChrome };
