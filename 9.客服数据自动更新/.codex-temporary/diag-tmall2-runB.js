// 2026-09-17 天猫2店 平响报表卡“加载中” 复现诊断（Run B）：
// 复现真实顺序 = 先「业绩页 + 施加 09-01~09-15 日期」→ 再「平响报表页」，并抓“发了请求但一直没回”的接口。
// 只做页面准备（prepareTmallReportPage），不触发导出/下载；结束时关掉 9333 浏览器。
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";
const path = require("path");
const 报告 = path.resolve(__dirname, "../runtime/logs/diag-tmall2-runB.log");
const fs = require("fs");

const 网络 = [];
const 待答 = new Map(); // 发起但没响应
const 失败 = [];
const 已挂 = new Set();
const 时间 = () => new Date().toISOString().slice(11, 19);
const 关注 = (u) => /report|export|analysis|datacenter|h5api|mtop|acs|api|voc|query|\.json/i.test(u);

function 挂页面(page) {
  if (!page || 已挂.has(page)) return;
  已挂.add(page);
  page.on("request", (r) => {
    const u = r.url();
    if (关注(u)) 待答.set(r, { 时: 时间(), 类: r.resourceType(), 址: u.slice(0, 200) });
  });
  page.on("response", (r) => {
    待答.delete(r.request());
    const u = r.url();
    const st = r.status();
    if (关注(u) || st >= 400) 网络.push({ 时: 时间(), 码: st, 类: r.request().resourceType(), 址: u.slice(0, 200) });
  });
  page.on("requestfailed", (r) => {
    待答.delete(r);
    失败.push({ 时: 时间(), 类: r.resourceType(), 错: r.failure()?.errorText, 址: r.url().slice(0, 200) });
  });
  page.on("console", (m) => {
    if (m.type() === "error") 失败.push({ 时: 时间(), 类: "console", 错: m.text().slice(0, 250), 址: "" });
  });
}

const pw = require("playwright-core");
const 原连接 = pw.chromium.connectOverCDP.bind(pw.chromium);
pw.chromium.connectOverCDP = async (...args) => {
  const browser = await 原连接(...args);
  const 挂全部 = () => {
    for (const ctx of browser.contexts()) {
      ctx.on("page", 挂页面);
      for (const p of ctx.pages()) 挂页面(p);
    }
  };
  挂全部();
  browser.__计时器 = setInterval(挂全部, 1500);
  return browser;
};

async function 读状态(page) {
  return await page.evaluate(() => {
    const 文本 = (document.body?.innerText || "").replace(/\n{2,}/g, "\n");
    const 找 = (re) => (文本.match(re) || []).length;
    return {
      地址: location.href,
      加载中次数: 找(/加载中/g),
      暂无数据次数: 找(/暂无数据|没有数据|无数据/g),
      表格节点数: document.querySelectorAll("table, .next-table, [class*=table]").length,
      统计时间文本: (文本.match(/统计时间[:：]?\s*[^\n]{0,40}/) || [""])[0],
      有平均响应时长表头: /平均响应时长/.test(文本),
      文本前300: 文本.slice(0, 300)
    };
  });
}

(async () => {
  const 结果 = { 步骤: [], 结论: "" };
  let browser = null;
  const 记 = (s) => {
    console.log(`[${时间()}] ${s}`);
    结果.步骤.push(`[${时间()}] ${s}`);
  };
  try {
    const { initializeProjectConfigForStartup } = require("../src/config/projectConfigServiceParts/projectConfigInitialization");
    const { readProjectConfig } = require("../src/config/projectConfigServiceParts/projectConfigPersistence");
    initializeProjectConfigForStartup(new Date());
    const cfg = readProjectConfig();
    const store = (cfg.tmall?.stores || []).find((s) => s.key === "tmall2");
    if (!store) throw new Error("配置里找不到 tmall2 店铺");
    store.siteUrl = require("../src/config/appConfig").tmall.siteUrl;

    const { ensureTmallSummaryWindow } = require("../src/summary/tmallSummaryWindow");
    await ensureTmallSummaryWindow({ store, onProgress: () => {} });
    记("窗口已打开");

    const { connectToChrome } = require("../src/engine/chromeSession");
    browser = await connectToChrome({ timeoutMs: 60000 });
    const { resolveTmallDateRange } = require("../src/platforms/tmall/tmallDateRange");
    const { prepareTmallReportPage, resolveTmallReportType } = require("../src/platforms/tmall/downloadTaskParts/tmallReportPreparation");
    const exportRange = resolveTmallDateRange(store);
    记(`日期范围=${exportRange.startText} ~ ${exportRange.endText}`);
    const 公共 = { resolvedConfig: { activeStore: store }, exportRange, onProgress: () => {}, options: {}, runtimeState: {} };

    // 第 1 步：业绩页（真实流程的第一步，内部会应用日期范围）
    try {
      await prepareTmallReportPage(browser, { ...公共, reportKey: "performance", reportType: resolveTmallReportType("performance"), sourceReportKeys: ["performance"] });
      记("步骤1 业绩页=就绪（日期已施加）");
    } catch (e) {
      记("步骤1 业绩页=失败 → " + String(e?.message || e).slice(0, 200));
    }

    // 第 2 步：平响报表页（就是失败的那一步）
    let 平响错 = "";
    try {
      await prepareTmallReportPage(browser, { ...公共, reportKey: "response_time", reportType: resolveTmallReportType("response_time"), sourceReportKeys: ["response_time"] });
    } catch (e) {
      平响错 = String(e?.message || e).slice(0, 250);
    }
    记(`步骤2 平响页=${平响错 ? "未就绪 → " + 平响错 : "就绪"}`);

    const { pickTmallResponseTimePage } = require("../src/platforms/tmall/responseTimeReportParts/tmallResponseTimeLogin");
    const page = await pickTmallResponseTimePage(browser).catch(() => null);
    if (page) {
      结果.状态_失败当时 = await 读状态(page).catch(() => null);
      await new Promise((r) => setTimeout(r, 30000));
      结果.状态_再等30秒 = await 读状态(page).catch(() => null);
    }

    结果.请求一直没回的接口 = [...待答.values()].slice(-15);
    结果.失败请求 = 失败.slice(-15);
    结果.非2xx = 网络.filter((r) => r.码 >= 400 || r.码 === 0).slice(-20);
    结果.报表相关_最后15条 = 网络.filter((r) => /report|export|analysis|voc|mtop/i.test(r.址)).slice(-15);
    结果.网络总数 = 网络.length;

    const 末 = 结果.状态_失败当时 || {};
    结果.结论 = !平响错
      ? "真实顺序下这次也成功了 → 限流/偶发"
      : (结果.请求一直没回的接口 || []).length
        ? `平响页失败，且有 ${结果.请求一直没回的接口.length} 个接口发了请求一直没回 → 平台侧接口挂起`
        : 末.加载中次数 > 0
          ? "平响页失败且仍显示“加载中”，但没抓到挂起接口 → 前端渲染问题"
          : "状态不明，见证据";
    记("结论=" + 结果.结论);
  } catch (e) {
    记("诊断异常: " + String(e?.message || e).slice(0, 250));
  } finally {
    fs.writeFileSync(报告, JSON.stringify(结果, null, 1));
    console.log("=== 结果 JSON 开始 ===");
    console.log(JSON.stringify(结果, null, 1));
    console.log("=== 结果 JSON 结束 ===");
    try {
      if (browser?.__计时器) clearInterval(browser.__计时器);
      if (browser) {
        const { disconnectFromChrome } = require("../src/engine/chromeSession");
        await disconnectFromChrome(browser, "诊断结束，断开调试连接");
      }
    } catch (_) {}
    try {
      const { waitForChromeDebugPortReady, closeManagedChrome, isLocalPortOpen } = require("../src/engine/chromeSession");
      const 已在 = await waitForChromeDebugPortReady({ timeoutMs: 1000, pollIntervalMs: 100 });
      if (已在) await closeManagedChrome();
      const 还开 = await waitForChromeDebugPortReady({ timeoutMs: 3000, pollIntervalMs: 300 });
      console.log(`9333 已关闭=${!还开}（端口占用=${await isLocalPortOpen(9333).catch(() => "?")}）`);
    } catch (e) {
      console.log("关浏览器警告: " + String(e?.message || e).slice(0, 120));
    }
    setTimeout(() => process.exit(0), 1500);
  }
})();
