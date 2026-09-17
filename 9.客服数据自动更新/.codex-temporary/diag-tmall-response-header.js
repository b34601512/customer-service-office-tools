// 只读诊断：连上 9号 当前 Chrome(9333)，把「平均响应时间」相关页面的真实表头/文案打出来
// 不点击、不输入、不关闭任何页面 —— 只为判断选择器为什么没命中
const { chromium } = require("playwright-core");

process.env.NO_PROXY = "127.0.0.1,localhost";

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());
  console.log(`  连接成功：${pages.length} 个页面`);
  for (const page of pages) {
    const url = page.url();
    if (!/taobao|tmall|qn\.|sycm/.test(url)) continue;
    console.log(`\n  === 页面: ${url.slice(0, 120)}`);
    console.log(`     标题: ${await page.title().catch(() => "?")}`);
    const 文本 = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const 行 = 文本.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const 相关 = 行.filter((s) => /响应|平均|暂无|没有数据|明细|导出|时长/.test(s));
    console.log(`     正文行数=${行.length}；含「响应/平均/导出/暂无」的行：`);
    相关.slice(0, 25).forEach((s) => console.log(`       · ${s.slice(0, 100)}`));
    // 表头单元格真实文案
    const 表头 = await page
      .locator("th, thead td, [class*='header'] span, [class*='Header'] span")
      .allInnerTexts()
      .catch(() => []);
    const 去重 = [...new Set(表头.map((s) => s.trim()).filter(Boolean))];
    console.log(`     表头类文本（${去重.length} 个，取前 30）：`);
    去重.slice(0, 30).forEach((s) => console.log(`       · ${s.slice(0, 80)}`));
    const 有无精确 = await page.getByText(/^\s*平均响应时长\s*$/).count().catch(() => -1);
    console.log(`     精确匹配「平均响应时长」的元素数 = ${有无精确}`);
    const 模糊 = await page.getByText(/平均响应时长/).count().catch(() => -1);
    console.log(`     模糊匹配「平均响应时长」的元素数 = ${模糊}`);
  }
  // 不调用 browser.close()：这是别人的浏览器，断连接即可
  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error("  诊断失败：", e.message);
  process.exit(1);
});
