#!/usr/bin/env node
/**
 * 把目标配置应用到京东客服「常见问题库」（可增/删/改）
 *
 * 用法：
 *   node src/tools/jd-faq-apply.js --config config/jd1-目标配置.json --port 9424            # dry-run：只打印计划
 *   node src/tools/jd-faq-apply.js --config config/jd1-目标配置.json --port 9424 --apply    # 真改后台
 *
 * 配置格式：{ keep:[{question,reply}], delete:[问题文本...], add:[{question,reply}] }
 *   - keep：问题文本必须已存在；回复会被覆盖（用于"改"）
 *   - delete：按问题文本精确删除
 *   - add：新增
 *
 * 安全：每步都回读校验（填入后读回值，不一致就中止，不点确定）；失败立即停止并截图。
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function argOf(name, fb) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fb; }
const APPLY = process.argv.includes("--apply");
const URL = "https://xi.jd.com/kf-manage-lite/#/UtilsSetting/AutoReply";

async function gotoFaq(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await sleep(9000);
  await page.evaluate(() => { const h = [...document.querySelectorAll("div,span,a,li")].find((e) => /^常见问题库$/.test((e.textContent || "").trim()) && e.offsetWidth); if (h) h.click(); });
  await sleep(7000);
  await page.evaluate(() => { const h = [...document.querySelectorAll("div,span,a,li")].find((e) => /^常见问题管理$/.test((e.textContent || "").trim()) && e.offsetWidth); if (h) h.click(); });
  await sleep(6000);
}

/** 读当前列表（问题 → 回复） */
async function readList(page) {
  return page.evaluate(() => {
    const rows = [];
    for (const btn of [...document.querySelectorAll("div,span,a,button,li")].filter((e) => /^删除$/.test((e.textContent || "").trim()) && e.offsetWidth)) {
      let node = btn, rowText = "";
      for (let i = 0; i < 7 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const t = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 6 && t.length < 600) { rowText = t; break; }
      }
      if (rowText) rows.push(rowText.replace(/\s*(预览)?\s*编辑\s*删除\s*$/, "").trim());
    }
    return rows;
  });
}

/** 在列表里点某问题的「编辑」或「删除」 */
async function clickRowAction(page, question, action) {
  return page.evaluate(({ q, act }) => {
    const btns = [...document.querySelectorAll("div,span,a,button,li")].filter((e) => new RegExp("^" + act + "$").test((e.textContent || "").trim()) && e.offsetWidth);
    for (const btn of btns) {
      let node = btn, rowText = "";
      for (let i = 0; i < 7 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const t = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 6 && t.length < 600) { rowText = t; break; }
      }
      if (rowText.includes(q)) { btn.click(); return true; }
    }
    return false;
  }, { q: question, act: action });
}

/** 弹窗里填问题+回复，回读校验，通过才点确定
 *  坑：用 execCommand 填 contenteditable 不会更新 React 状态（计数仍显示 0/400），点确定无效。
 *      必须用 Playwright 原生 fill（会派发标准 input 事件）。
 */
async function fillDialog(page, question, reply) {
  const ta = page.locator("textarea:visible").first();
  const ce = page.locator("[contenteditable=true]:visible").first();
  if (!(await ta.count().catch(() => 0)) || !(await ce.count().catch(() => 0))) return { err: "找不到问题/回复输入框" };
  await ta.click();
  await ta.fill("");
  await ta.fill(question);
  await ce.click();
  await ce.fill("");
  await ce.fill(reply);
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => {
    const t = [...document.querySelectorAll("textarea")].filter((e) => e.offsetWidth)[0];
    const c = [...document.querySelectorAll("[contenteditable=true]")].filter((e) => e.offsetWidth)[0];
    return { q: String(t?.value || "").trim(), r: String(c?.innerText || "").trim() };
  });
  if (back.q !== question.trim()) return { err: `问题回读不一致: "${back.q}"` };
  if (!back.r.includes(reply.trim().slice(0, 20))) return { err: `回复回读不一致: "${back.r.slice(0, 40)}"` };
  // React 状态是否真的更新了：看字数计数器（问题 n/30、回复 n/400）
  const counters = await page.evaluate(() => {
    const t = [...document.querySelectorAll("textarea")].filter((e) => e.offsetWidth)[0];
    let node = t, txt = "";
    for (let i = 0; i < 6 && node; i++) { node = node.parentElement; if (!node) break; txt = (node.textContent || "").replace(/\s+/g, " "); if (/\d+\s*\/\s*30/.test(txt) && /\d+\s*\/\s*400/.test(txt)) break; }
    const m = txt.match(/(\d+)\s*\/\s*30[\s\S]*?(\d+)\s*\/\s*400/);
    return m ? { q: Number(m[1]), r: Number(m[2]) } : null;
  });
  if (counters && (counters.q === 0 || counters.r === 0)) return { err: `React 状态没更新（计数 ${counters.q}/30, ${counters.r}/400）` };
  return { ok: true, counters };
}

async function clickConfirm(page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll("div,span,a,button,li")].filter((e) => /^确定$/.test((e.textContent || "").trim()) && e.offsetWidth);
    if (!btns.length) return false;
    btns[btns.length - 1].click();
    return true;
  });
}

(async () => {
  const cfgPath = argOf("config");
  const port = argOf("port", "9424");
  if (!cfgPath) { console.error("  用法: --config <json> [--port 9424] [--apply]"); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(path.resolve(cfgPath), "utf8"));
  console.log(`  目标配置：${cfgPath}`);
  console.log(`  保留/改 ${cfg.keep.length} 条 ｜ 删 ${cfg.delete.length} 条 ｜ 新增 ${cfg.add.length} 条 → 终态 ${cfg.keep.length + cfg.add.length} 条`);
  const dumpTo = argOf("dump-config");
  if (!APPLY && !dumpTo) { console.log("\n  （dry-run：不连浏览器、不改后台。加 --apply 才真改）"); process.exit(0); }

  // --dump-config <file>：逐条点「编辑」把当前后台配置导出成同格式 JSON（keep 填满，delete/add 空）
  if (dumpTo) {
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const ctx = b.contexts()[0];
    const pg = ctx.pages().find((x) => /xi\.jd\.com/.test(x.url())) || ctx.pages()[0];
    await pg.bringToFront().catch(() => {});
    await gotoFaq(pg);
    const count = await pg.evaluate(() => [...document.querySelectorAll("div,span,a,button,li")].filter((e) => /^编辑$/.test((e.textContent || "").trim()) && e.offsetWidth).length);
    console.log(`  发现 ${count} 个编辑按钮，逐条读取…`);
    const pairs = [];
    for (let i = 0; i < count; i++) {
      const ok = await pg.evaluate((idx) => {
        const btns = [...document.querySelectorAll("div,span,a,button,li")].filter((e) => /^编辑$/.test((e.textContent || "").trim()) && e.offsetWidth);
        if (!btns[idx]) return false;
        btns[idx].click();
        return true;
      }, i);
      if (!ok) break;
      await pg.waitForTimeout(4000);
      const pair = await pg.evaluate(() => {
        const t = [...document.querySelectorAll("textarea")].filter((e) => e.offsetWidth)[0];
        const c = [...document.querySelectorAll("[contenteditable=true]")].filter((e) => e.offsetWidth)[0];
        return { question: String(t?.value || "").trim(), reply: String(c?.innerText || "").trim() };
      });
      if (pair.question) pairs.push(pair);
      await pg.keyboard.press("Escape").catch(() => {});
      await pg.evaluate(() => { const b = [...document.querySelectorAll("div,span,a,button,li")].filter((e) => /^取消$/.test((e.textContent || "").trim()) && e.offsetWidth); if (b.length) b[b.length - 1].click(); });
      await pg.waitForTimeout(2500);
    }
    fs.writeFileSync(path.resolve(dumpTo), JSON.stringify({ store: argOf("store", "jd1"), note: "导出当前配置", keep: pairs, delete: [], add: [] }, null, 2), "utf8");
    console.log(`  ✓ 已导出 ${pairs.length} 条到 ${dumpTo}`);
    pairs.forEach((x, i) => console.log(`    ${i + 1}. ${x.question}  （回复 ${x.reply.length} 字）`));
    if (!APPLY) process.exit(0);
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages().find((p) => /xi\.jd\.com/.test(p.url())) || context.pages()[0];
  await page.bringToFront().catch(() => {});
  await gotoFaq(page);

  const before = await readList(page);
  console.log(`\n  改前 ${before.length} 条：`);
  before.forEach((r, i) => console.log(`    ${i + 1}. ${r.slice(0, 40)}`));

  const fail = async (msg) => { await page.screenshot({ path: `runtime/失败-${Date.now()}.png` }).catch(() => {}); console.error(`\n  ✗ 中止：${msg}`); process.exit(1); };

  // ① 改：keep 里问题已存在的，覆盖回复
  for (const item of cfg.keep) {
    const exists = (await readList(page)).some((r) => r.includes((item.from || item.question).split("？")[0].slice(0, 8)));
    if (!exists) { console.log(`\n  ⏭ 跳过改（列表里没有相近问题）：${item.from || item.question}`); continue; }
    // 定位用 from（旧文本，可选）；不传则用新问题文本
    const oldQ = item.from || item.question;
    const clicked = await clickRowAction(page, oldQ, "编辑");
    if (!clicked) { await fail(`找不到「编辑」按钮：${oldQ}`); }
    await sleep(4500);
    const filled = await fillDialog(page, item.question, item.reply);
    if (filled.err) await fail(`填值校验失败（${item.question}）：${filled.err}`);
    await sleep(1200);
    if (!(await clickConfirm(page))) await fail("找不到弹窗「确定」");
    await sleep(7000);
    console.log(`  ✓ 已改：${item.question}`);
  }

  // ② 删
  for (const q of cfg.delete) {
    const clicked = await clickRowAction(page, q, "删除");
    if (!clicked) { console.log(`  ⏭ 跳过删（列表里已没有）：${q}`); continue; }
    await sleep(4000);
    if (!(await clickConfirm(page))) await fail(`删除确认弹窗没出现：${q}`);
    await sleep(7000);
    const still = (await readList(page)).some((r) => r.includes(q.slice(0, 8)));
    if (still) await fail(`删除后仍存在：${q}`);
    console.log(`  ✓ 已删：${q}`);
  }

  // ③ 加
  for (const item of cfg.add) {
    const exists = (await readList(page)).some((r) => r.includes(item.question.slice(0, 8)));
    if (exists) { console.log(`  ⏭ 跳过加（已存在）：${item.question}`); continue; }
    const opened = await page.evaluate(() => { const h = [...document.querySelectorAll("div,span,a,button,li")].find((e) => /添加常见问题/.test((e.textContent || "").trim()) && e.offsetWidth && (e.textContent || "").trim().length < 20); if (h) { h.click(); return true; } return false; });
    if (!opened) await fail("找不到「添加常见问题」按钮");
    await sleep(4500);
    const filled = await fillDialog(page, item.question, item.reply);
    if (filled.err) await fail(`新增填值失败（${item.question}）：${filled.err}`);
    await sleep(1200);
    if (!(await clickConfirm(page))) await fail("找不到弹窗「确定」");
    await sleep(7500);
    const added = (await readList(page)).some((r) => r.includes(item.question.slice(0, 8)));
    if (!added) await fail(`新增后列表里没找到：${item.question}`);
    console.log(`  ✓ 已加：${item.question}`);
  }

  const after = await readList(page);
  console.log(`\n  ✅ 完成：改后 ${after.length} 条`);
  after.forEach((r, i) => console.log(`    ${i + 1}. ${r.slice(0, 40)}`));
  await page.screenshot({ path: "runtime/应用后.png" }).catch(() => {});
  process.exit(0);
})().catch((e) => { console.error("  失败：", e && e.message ? e.message : e); process.exit(1); });
