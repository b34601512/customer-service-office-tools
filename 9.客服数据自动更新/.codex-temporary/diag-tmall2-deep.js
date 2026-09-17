// 2026-09-17 天猫2店「平均响应时间」报表卡“加载中…”只读诊断：
// 目的 = 判断是「平台/页面问题」还是「该店真没数据」。
// 只读：不改配置、不点导出、不提交；结束时必须关掉 9333 的浏览器（9号硬约束：端口串行）。
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";
const path = require("path");
const 项目根 = path.resolve(__dirname, "..");

const 网络记录 = [];
const 失败记录 = [];
const 已挂 = new Set();
const 时间 = () => new Date().toISOString().slice(11, 19);
const 关注 = (u) => /report|export|analysis|datacenter|h5api|mtop|acs|api|voc|query|\.json/i.test(u);

function 挂页面(page) {
  if (!page || 已挂.has(page)) return;
  已挂.add(page);
  page.on("response", (r) => {
    const u = r.url();
    const st = r.status();
    if (关注(u) || st >= 400) {
      网络记录.push({ 时: 时间(), 码: st, 类: r.request().resourceType(), 址: u.slice(0, 200) });
    }
  });
  page.on("requestfailed", (r) => {
    失败记录.push({ 时: 时间(), 类: r.resourceType(), 错: r.failure()?.errorText, 址: r.url().slice(0, 200) });
  });
  page.on("console", (m) => {
    if (m.type() === "error") 失败记录.push({ 时: 时间(), 类: "console", 错: m.text().slice(0, 200), 址: "" });
  });
}

// 拦 connectOverCDP：给项目自己建/接的每个页面都挂上监听（不改项目代码）
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

async function 读页面状态(page) {
  return await page.evaluate(() => {
    const 文本 = (document.body?.innerText || "").replace(/\n{2,}/g, "\n");
    const 找 = (re) => (文本.match(re) || []).length;
    const 表头 = Array.from(document.querySelectorAll("th,td,div,span"))
      .map((e) => (e.textContent || "").trim())
      .filter((t) => t && t.length < 30 && /平均响应时长|人工接待会话量|店铺名|客服/.test(t))
      .slice(0, 8);
    const 表格数 = document.querySelectorAll("table, .next-table, [class*=table]").length;
    const 加载中块 = Array.from(document.querySelectorAll("*"))
      .filter((e) => (e.textContent || "").includes("加载中") && e.children.length === 0)
      .slice(0, 3)
      .map((e) => {
        const 父 = e.parentElement;
        return { 自身: (e.textContent || "").trim().slice(0, 20), 父文本: (父?.textContent || "").trim().slice(0, 120) };
      });
    return {
      地址: location.href,
      文本长度: 文本.length,
      加载中次数: 找(/加载中/g),
      暂无数据次数: 找(/暂无数据|没有数据|无数据/g),
      表头片段: 表头,
      表格节点数: 表格数,
      加载中块,
      文本前600: 文本.slice(0, 600)
    };
  });
}

(async () => {
  const 结果 = { 阶段: "启动", 结论: "", 证据: {} };
  let browser = null;
  try {
    const { initializeProjectConfigForStartup } = require("../src/config/projectConfigServiceParts/projectConfigInitialization");
    const { readProjectConfig } = require("../src/config/projectConfigServiceParts/projectConfigPersistence");
    initializeProjectConfigForStartup(new Date());
    const cfg = readProjectConfig();
    const store = (cfg.tmall?.stores || []).find((s) => s.key === "tmall2");
    if (!store) throw new Error("配置里找不到 tmall2 店铺");
    // 真实跑时天猫窗口开的是 appConfig 里的官方下载目标页（sycm 业绩页），这里照样补上
    if (!store.siteUrl) store.siteUrl = require("../src/config/appConfig").tmall.siteUrl;
    console.log(`店铺=${store.displayName} 平台名=${store.platformStoreName} 开窗地址=${store.siteUrl}`);

    结果.阶段 = "开窗";
    const { ensureTmallSummaryWindow } = require("../src/summary/tmallSummaryWindow");
    await ensureTmallSummaryWindow({ store, onProgress: () => {} });

    结果.阶段 = "连接";
    const { connectToChrome, disconnectFromChrome } = require("../src/engine/chromeSession");
    browser = await connectToChrome({ timeoutMs: 60000 });

    结果.阶段 = "取页面";
    const { pickTmallResponseTimePage, resolveTmallResponseTimeEntranceUrl } = require("../src/platforms/tmall/responseTimeReportParts/tmallResponseTimeLogin");
    const 入口 = resolveTmallResponseTimeEntranceUrl("response_time");
    const page = await pickTmallResponseTimePage(browser, 入口);
    await page.bringToFront().catch(() => {});
    console.log(`入口地址=${入口}`);

    结果.阶段 = "打开入口";
    await page.goto(入口, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.log("goto 警告: " + e.message.slice(0, 120)));

    结果.阶段 = "走流程(只试1次)";
    const { prepareTmallResponseTimeExportPage } = require("../src/platforms/tmall/responseTimeReportParts/tmallResponseTimeReportFlow");
    let 流程错 = "";
    try {
      await prepareTmallResponseTimeExportPage(page, {
        entranceUrl: 入口,
        timeoutMs: 60000,
        报表尝试次数: 1,
        onProgress: () => {}
      });
    } catch (e) {
      流程错 = String(e?.message || e).slice(0, 300);
    }
    console.log(`流程结果=${流程错 ? "未就绪 → " + 流程错 : "就绪（这次成功）"}`);

    结果.阶段 = "读页面";
    结果.证据.首次 = await 读页面状态(page);

    // 再等 30 秒，看“加载中”是否只是慢
    await new Promise((r) => setTimeout(r, 30000));
    结果.证据.再等30秒 = await 读页面状态(page);

    // 换页签看看是不是所有页签都卡（只点击页面自己的页签，不动数据）
    for (const 页签 of ["按时段查看", "按咨询问题查看", "按客服查看"]) {
      const hit = page.getByText(页签, { exact: true }).first();
      if ((await hit.count().catch(() => 0)) > 0) {
        await hit.click({ timeout: 5000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 8000));
        结果.证据[`页签_${页签}`] = await 读页面状态(page);
      }
    }

    // 只读看“加载中”附近有没有接口报错/请求地址
    结果.证据.网络_非2xx = 网络记录.filter((r) => r.码 >= 400 || r.码 === 0).slice(-25);
    结果.证据.网络_报表相关 = 网络记录.filter((r) => /report|export|analysis|voc|mtop|aco/i.test(r.址)).slice(-25);
    结果.证据.请求失败 = 失败记录.slice(-15);
    结果.证据.网络总数 = 网络记录.length;

    const 首 = 结果.证据.首次;
    const 末 = 结果.证据.再等30秒;
    结果.结论 = !流程错
      ? "报表这次正常就绪 → 之前是偶发/限流"
      : 末.加载中次数 > 0 && 末.暂无数据次数 === 0
        ? "表格持续停在“加载中”（不是没数据）→ 倾向前端/接口侧问题"
        : 末.暂无数据次数 > 0
          ? "出现“暂无数据” → 该店该区间确实无数据"
          : "状态不明，看证据";
    console.log("结论=" + 结果.结论);
  } catch (e) {
    console.log("诊断异常: " + String(e?.message || e).slice(0, 300));
    结果.结论 = 结果.结论 || "诊断中断：" + String(e?.message || e).slice(0, 120);
  } finally {
    console.log("=== 证据 JSON 开始 ===");
    console.log(JSON.stringify(结果, null, 1).slice(0, 12000));
    console.log("=== 证据 JSON 结束 ===");
    try {
      if (browser && browser.__计时器) clearInterval(browser.__计时器);
      if (browser) {
        const { disconnectFromChrome } = require("../src/engine/chromeSession");
        await disconnectFromChrome(browser, "天猫2店诊断结束，断开调试连接");
      }
    } catch (_) {}
    // 9号 硬约束：跑完必关浏览器，别占着 9333（用项目自己的收口）
    try {
      const { waitForChromeDebugPortReady, closeManagedChrome, isLocalPortOpen } = require("../src/engine/chromeSession");
      const 已在 = await waitForChromeDebugPortReady({ timeoutMs: 1000, pollIntervalMs: 100 });
      if (已在) {
        await closeManagedChrome();
      }
      const 还开 = await waitForChromeDebugPortReady({ timeoutMs: 3000, pollIntervalMs: 300 });
      console.log(`9333 已关闭=${!还开}（端口占用=${await isLocalPortOpen(9333).catch(() => "?")}）`);
    } catch (e) {
      console.log("关浏览器警告: " + String(e?.message || e).slice(0, 120));
    }
    setTimeout(() => process.exit(0), 1500);
  }
})();
