#!/usr/bin/env node
/**
 * 抓取京东客服「进店导航问答」= 欢迎语 → 常见问题库
 *   - 常见问题管理：问题 + 回复（含名额 x/10）
 *   - 常见问题数据：问题 + 最近修改时间 + 近7日点击量
 *
 * 用法：
 *   node src/tools/jd-faq-overview.js --store jd1 --port 9424
 *   node src/tools/jd-faq-overview.js --store jd1 --port 9424 --json
 *
 * 说明：直接 CDP 附着到已登录浏览器（不自己启登录流程）。
 *      浏览器没开时先用别的方式拉起对应端口（jd1=9424）。
 */
const { chromium } = require("playwright-core");

const DEFAULT_URL = "https://xi.jd.com/kf-manage-lite/#/UtilsSetting/AutoReply";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function clickText(page, re) {
  return page.evaluate((src) => {
    const rx = new RegExp(src);
    const hit = [...document.querySelectorAll("div,span,a,li,button")]
      .find((el) => el.offsetWidth && rx.test((el.textContent || "").trim()));
    if (hit) { hit.click(); return true; }
    return false;
  }, re.source).catch(() => false);
}

async function readText(page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")).catch(() => "");
}

/** 「常见问题管理」解析：序号 问题 回复 … 1 问题文案 回复文案 - 编辑 删除 2 … */
function parseManage(text) {
  const m = text.match(/添加常见问题（(\d+)\/(\d+)）/);
  const quota = m ? { used: Number(m[1]), max: Number(m[2]) } : null;
  const items = [];
  const seg = text.slice(text.indexOf("常见问题管理") + 5);
  const re = /(\d+)\s+(.+?)\s+(?:-\s*|预览\s*)?(?:编辑)?删除/g;
  let hit;
  while ((hit = re.exec(seg))) items.push({ index: Number(hit[1]), raw: hit[2].trim() });
  return { quota, items };
}

/** 「常见问题数据」解析：问题 修改时间 点击量（三列循环） */
function parseStats(text) {
  const HEAD = "近7日点击量";
  const seg = text.slice(text.indexOf(HEAD) + HEAD.length);
  const re = /(.+?)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\d+)/g;
  const rows = [];
  let hit;
  while ((hit = re.exec(seg))) rows.push({ question: hit[1].trim(), modified: hit[2], clicks7d: Number(hit[3]) });
  return rows;
}

(async () => {
  const port = argOf("port", "9424");
  const store = argOf("store", "jd1");
  const asJson = process.argv.includes("--json");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages().slice(-1)[0] || (await context.newPage());
  await page.bringToFront().catch(() => {});
  await page.goto(DEFAULT_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await sleep(9000);

  // 「常见问题库」 → 「常见问题管理」 → 「常见问题数据」
  await clickText(page, /^常见问题库$/);
  await sleep(8000);
  await clickText(page, /^常见问题管理$/);
  await sleep(7000);
  const manageText = await readText(page);
  await clickText(page, /^常见问题数据$/);
  await sleep(9000);
  const statsText = await readText(page);

  const manage = parseManage(manageText);
  const stats = parseStats(statsText);

  if (asJson) {
    console.log(JSON.stringify({ store, url: page.url(), quota: manage.quota, items: manage.items, stats }, null, 2));
  } else {
    console.log(`【${store}】京东进店导航问答（常见问题库）`);
    console.log(`  名额：${manage.quota ? `${manage.quota.used}/${manage.quota.max}` : "未读到"}`);
    console.log(`  配置 ${manage.items.length} 条 / 点击数据 ${stats.length} 条`);
    if (stats.length) {
      console.log("  近7日点击量：");
      [...stats].sort((a, b) => b.clicks7d - a.clicks7d)
        .forEach((r) => console.log(`    ${String(r.clicks7d).padStart(4)} 次  ${r.question.slice(0, 34)}`));
      const total = stats.reduce((s, r) => s + r.clicks7d, 0);
      console.log(`  合计 ${total} 次 / 7 天`);
    }
  }
  process.exit(0);
})().catch((err) => {
  console.error("  失败：", err && err.message ? err.message : err);
  process.exit(1);
});
