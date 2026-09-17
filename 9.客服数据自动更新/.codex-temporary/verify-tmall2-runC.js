// Run C（2026-09-17 下午）：删除“天猫平响回退重试”后的验证性真跑。
// 只走我改过的那条路径（登录就绪 → 服务体验分析 → 点旺旺人工平响时长 → 等表头就绪），
// 不点导出、不下载、不写工作簿；结束时关掉 9333 浏览器。
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";
const path = require("path");
const fs = require("fs");
const 报告 = path.resolve(__dirname, "../runtime/logs/diag-tmall2-runC.log");

(async () => {
  const 记 = [];
  const 输出 = (s) => {
    console.log(s);
    记.push(s);
  };
  let browser = null;
  try {
    const { initializeProjectConfigForStartup } = require("../src/config/projectConfigServiceParts/projectConfigInitialization");
    const { readProjectConfig } = require("../src/config/projectConfigServiceParts/projectConfigPersistence");
    initializeProjectConfigForStartup(new Date());
    const cfg = readProjectConfig();
    const store = (cfg.tmall?.stores || []).find((s) => s.key === "tmall2");
    store.siteUrl = require("../src/config/appConfig").tmall.siteUrl;

    const { ensureTmallSummaryWindow } = require("../src/summary/tmallSummaryWindow");
    await ensureTmallSummaryWindow({ store, onProgress: () => {} });
    输出("窗口已打开");

    const { connectToChrome } = require("../src/engine/chromeSession");
    browser = await connectToChrome({ timeoutMs: 60000 });

    const { prepareTmallReportPage, resolveTmallReportType } = require("../src/platforms/tmall/downloadTaskParts/tmallReportPreparation");
    const { resolveTmallDateRange } = require("../src/platforms/tmall/tmallDateRange");
    const exportRange = resolveTmallDateRange(store);
    const 起点 = Date.now();
    try {
      await prepareTmallReportPage(browser, {
        reportKey: "response_time",
        reportType: resolveTmallReportType("response_time"),
        resolvedConfig: { activeStore: store },
        exportRange,
        sourceReportKeys: ["response_time"],
        onProgress: () => {},
        options: {},
        runtimeState: {}
      });
      输出(`验证结果=通过（平响报表就绪，耗时 ${Math.round((Date.now() - 起点) / 1000)} 秒，只试一次、未重试）`);
    } catch (e) {
      输出(`验证结果=失败 → ${String(e?.message || e).slice(0, 200)}`);
    }
  } catch (e) {
    输出("验证异常: " + String(e?.message || e).slice(0, 250));
  } finally {
    try {
      fs.writeFileSync(报告, 记.join("\n"));
    } catch (_) {}
    try {
      if (browser) {
        const { disconnectFromChrome } = require("../src/engine/chromeSession");
        await disconnectFromChrome(browser, "Run C 验证结束");
      }
    } catch (_) {}
    try {
      const { waitForChromeDebugPortReady, closeManagedChrome, isLocalPortOpen } = require("../src/engine/chromeSession");
      if (await waitForChromeDebugPortReady({ timeoutMs: 1000, pollIntervalMs: 100 })) await closeManagedChrome();
      const 还开 = await waitForChromeDebugPortReady({ timeoutMs: 3000, pollIntervalMs: 300 });
      console.log(`9333 已关闭=${!还开}（端口占用=${await isLocalPortOpen(9333).catch(() => "?")}）`);
    } catch (e) {
      console.log("关浏览器警告: " + String(e?.message || e).slice(0, 120));
    }
    setTimeout(() => process.exit(0), 1500);
  }
})();
