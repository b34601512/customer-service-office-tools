#!/usr/bin/env node
// 31号：京东魔方「客服销售分析」逐店导出（只读：只导航/查询/点导出/下载；不做任何写操作）。
//
// 数据链：魔方（九易 yiyitech，京东服务市场 app FW_GOODS-908622）→ 京麦里人工导出「客服销售分析_起_止_全部客服.xlsx」。
//   自动化路径：浏览器登录态（profile 里）→ joyi.yiyitech.com SPA → 页面内直接调起页面自己的
//   exportExcelTask（等价于点「导出」，走它自己的 axios 带 Authorization）→ 轮询
//   /task/export/selectByShopIdExportLst 拿文件地址 → 下载 xlsx 到 runtime/downloads/<年月>/。
//   · 登录 = 京东 OAuth 授权一次（joyi 页面 ?token=… 存 localStorage）；登录态失效时工具会
//     把窗口停在 OAuth 授权页，等人工点一次（之后 token 长期有效，直到再次失效）。
//   · 单店卡住 → 留下可见窗口、跳过该店继续；失败不自动重试。
//
// 用法：
//   node src/tools/jd-魔方-客服销售分析-导出.js --year-month 2026-09            # 默认 jd1/jd3（stores.json mofangKeys）
//   node src/tools/jd-魔方-客服销售分析-导出.js --year-month 2026-09 --store jd1
//   node src/tools/jd-魔方-客服销售分析-导出.js --year-month 2026-09 --dry
//   可选：--out <目录>、--保持窗口
const fs = require("node:fs");
const path = require("node:path");
const { 全部店铺, 读配置, 项目根 } = require("../config/stores");
const engine = require("../engine/browser");
const XLSX = require(path.resolve(项目根, "..", "9.客服数据自动更新", "node_modules", "xlsx"));

const 魔方页 = "https://joyi.yiyitech.com/#/data-analysis/transaction-analysis/sale-analysis/custom-sale";
const OAuth入口 = "https://open-oauth.jd.com/oauth2/to_login?app_key=321CEAB001F59FDDA67DC388C0575958&response_type=code&redirect_uri=http%3A%2F%2Fgwjoyi.yiyitech.com%2Fweb-report%2Flogin%2Fmain&scope=snsapi_base&state=direct_";
const 必填源列 = ["订单编号", "顾客昵称", "订单状态", "下单时间", "付款时间", "出库时间", "订单金额（元）", "客服昵称", "开始时间", "结束时间", "顾客mofangID"];

function 解析参数(argv) {
  const 参数 = { yearMonth: "", stores: [], out: "", dry: false, keepOpen: false };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--year-month") { 参数.yearMonth = argv[i + 1] || ""; i += 1; }
    else if (词 === "--store") { 参数.stores.push(argv[i + 1] || ""); i += 1; }
    else if (词 === "--out") { 参数.out = argv[i + 1] || ""; i += 1; }
    else if (词 === "--dry") 参数.dry = true;
    else if (词 === "--保持窗口") 参数.keepOpen = true;
    else if (词 === "--help" || 词 === "-h") 参数.help = true;
  }
  return 参数;
}

function 月末日期(年月) {
  const m = /^(\d{4})-(\d{2})$/.exec(年月);
  if (!m) throw new Error(`--year-month 格式应为 2026-09，收到「${年月}」`);
  const 年 = Number(m[1]); const 月 = Number(m[2]);
  const 末 = new Date(年, 月, 0).getDate();
  return { startDate: `${年月}-01`, endDate: `${年月}-${String(末).padStart(2, "0")}` };
}

function 睡觉(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 页面内：设日期范围 → 打开「导出中心」→ 有「条件匹配+完成」的行就点下载（浏览器下载事件落盘）；
// 没有就先调页面自己的 exportExcelTask 建任务，再轮询导出中心（最多 ~180 秒）。
async function 页内导出(page, { startDate, endDate, 目标 }) {
  const 设日期 = () => page.evaluate(({ startDate, endDate }) => {
    const 根 = document.querySelector("#app") && document.querySelector("#app").__vue__;
    const 找组件 = (vm) => {
      if (!vm) return null;
      if (vm.$options && vm.$options.methods && vm.$options.methods.exportExcelTask) return vm;
      for (const c of (vm.$children || [])) { const h = 找组件(c); if (h) return h; }
      return null;
    };
    const vm = 找组件(根);
    if (!vm) return false;
    if (vm.form) vm.form.daterange = [startDate, endDate];
    return true;
  }, { startDate, endDate }).catch(() => false);

  // 对话框可见性（多份副本，任一大尺寸即可）
  const 中心可见 = () => page.evaluate(() => {
    return [...document.querySelectorAll(".export-dialog")].some((d) => {
      const r = d.getBoundingClientRect();
      return r.height > 10 && r.width > 10;
    });
  }).catch(() => false);
  const 开中心 = async () => {
    for (let i = 0; i < 3; i += 1) {
      if (await 中心可见()) return true;
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("button")].find((e) => (e.innerText || "").trim() === "导出");
        if (el) el.click();
      }).catch(() => {});
      await 睡觉(2500);
    }
    return 中心可见();
  };
  const 关中心 = async () => {
    await page.keyboard.press("Escape").catch(() => {});
    await 睡觉(1200);
  };

  // 导出中心可能渲染多份（隐藏副本 + 可见副本），一律跨所有 .export-dialog 找行
  const 找完成行 = () => page.evaluate(({ startDate, endDate }) => {
    for (const d of document.querySelectorAll(".export-dialog")) {
      for (const tr of d.querySelectorAll("tr")) {
        const t = (tr.innerText || "").replace(/\s+/g, " ");
        if (!t.trim()) continue;
        if (t.indexOf(`_${startDate}_${endDate}_`) >= 0 && /完成/.test(t)) return t.slice(0, 90);
      }
    }
    return "";
  }, { startDate, endDate }).catch(() => "");

  // 点该行的「下载」→ 等浏览器下载事件 → 落盘（JS click，不依赖可见性）
  const 试下载 = async () => {
    const 有 = await 找完成行();
    if (!有) return "";
    const 下载等 = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
    await page.evaluate(({ startDate, endDate }) => {
      for (const d of document.querySelectorAll(".export-dialog")) {
        for (const tr of d.querySelectorAll("tr")) {
          const t = (tr.innerText || "").replace(/\s+/g, " ");
          if (t.indexOf(`_${startDate}_${endDate}_`) >= 0 && /完成/.test(t)) {
            const 下载 = [...tr.querySelectorAll("button,a,span")].find((e) => (e.innerText || "").trim() === "下载");
            if (下载) { 下载.click(); return; }
          }
        }
      }
    }, { startDate, endDate }).catch(() => {});
    const dl = await 下载等;
    if (!dl) return "";
    await dl.saveAs(目标);
    return 有;
  };

  // 找「导出条件带本区间」的行（不限状态；完成→可下载，进行中→等）
  const 找任意匹配行 = () => page.evaluate(({ startDate, endDate }) => {
    for (const d of document.querySelectorAll(".export-dialog")) {
      for (const tr of d.querySelectorAll("tr")) {
        const t = (tr.innerText || "").replace(/\s+/g, " ");
        if (t.indexOf(`_${startDate}_${endDate}_`) >= 0) return t.slice(0, 90);
      }
    }
    return "";
  }, { startDate, endDate }).catch(() => "");

  if (!(await 设日期())) return { ok: false, step: "vue", message: "找不到页面组件（#app.__vue__）" };
  await 开中心();
  let 命中 = await 试下载();
  if (!命中) {
    const 已有任务 = await 找任意匹配行();
    if (!已有任务) {
      await page.evaluate(async () => {
        const 根 = document.querySelector("#app") && document.querySelector("#app").__vue__;
        const 找组件 = (vm) => {
          if (!vm) return null;
          if (vm.$options && vm.$options.methods && vm.$options.methods.exportExcelTask) return vm;
          for (const c of (vm.$children || [])) { const h = 找组件(c); if (h) return h; }
          return null;
        };
        const vm = 找组件(根);
        if (vm) { try { await vm.exportExcelTask(); } catch (e) { /* 建任务失败也继续轮询 */ } }
      }).catch(() => {});
      console.log("    [魔方] 没找到已有导出，已新建导出任务");
    } else {
      console.log("    [魔方] 已有本区间导出任务，等它完成");
    }
    for (let i = 0; i < 24; i += 1) {
      await 睡觉(15000);
      命中 = await 试下载();
      console.log(`    [魔方] 第 ${i + 1} 次等导出：${命中 ? "拿到文件" : "还没完成"}`);
      if (命中) break;
    }
  }
  if (!命中) return { ok: false, step: "poll", message: "导出任务还没完成（等了约 6 分钟）" };
  return { ok: true, name: 命中, size: fs.statSync(目标).size };
}

function 校验xlsx(文件) {
  const wb = XLSX.readFile(文件);
  const 页名 = wb.SheetNames.find((n) => n.includes("客服销售分析")) || wb.SheetNames[0];
  const 行 = XLSX.utils.sheet_to_json(wb.Sheets[页名], { header: 1, blankrows: false, raw: true });
  if (行.length < 2) return { ok: false, 原因: "文件没有数据行" };
  const 表头 = (行[0] || []).map((v) => String(v ?? "").trim());
  const 缺列 = 必填源列.filter((名) => !表头.includes(名));
  if (缺列.length) return { ok: false, 原因: `表头缺列：${缺列.join("、")}（实际：${表头.join("、")}）` };
  return { ok: true, 行数: 行.length - 1, 表头 };
}

async function 跑一店(店铺, 参数, 输出目录) {
  const { startDate, endDate } = 月末日期(参数.yearMonth);
  const 结果 = { key: 店铺.key, displayName: 店铺.displayName, status: "", detail: "" };
  let session = null;
  try {
    session = await engine.openStoreBrowser({ profileDir: 店铺.profileDir, targetUrl: 魔方页, debugPort: 店铺.port, keepOpen: true });
    const page = session.page || await engine.firstPage(session.context, 魔方页);
    await page.bringToFront().catch(() => {});
    await 睡觉(6000);

    const 当前url = page.url();
    const 文本 = await page.evaluate(() => document.body.innerText).catch(() => "");
    const 有token = await page.evaluate(() => Boolean(localStorage.getItem("joyi_token") || localStorage.getItem("token"))).catch(() => false);
    const 像登录页 = /passport\.jd\.com|\/login/i.test(当前url) || /登录|授权/.test(文本) && !/客服销售分析/.test(文本);
    if (!有token || 像登录页) {
      结果.status = "需要登录";
      结果.detail = `魔方未授权（token=${有token ? "有" : "无"}，url=${当前url}）`;
      const 授权页 = `${OAuth入口}${Date.now()}`;
      await page.goto(授权页, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.bringToFront().catch(() => {});
      return 结果;
    }

    const 目标 = path.join(输出目录, `${店铺.key}_客服销售分析_${参数.yearMonth}.xlsx`);
    const 导出 = await 页内导出(page, { startDate, endDate, 目标 });
    if (!导出.ok) {
      if (导出.step === "login") {
        结果.status = "需要登录";
        结果.detail = `魔方登录态失效：${导出.message}`;
        const 授权页 = `${OAuth入口}${Date.now()}`;
        await page.goto(授权页, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
        await page.bringToFront().catch(() => {});
        return 结果;
      }
      结果.status = "导出失败";
      结果.detail = `${导出.step}: ${导出.message}`;
      return 结果;
    }
    const 校验 = 校验xlsx(目标);
    if (!校验.ok) {
      结果.status = "文件校验失败";
      结果.detail = 校验.原因;
      return 结果;
    }
    结果.status = "成功";
    结果.detail = `${校验.行数} 行，${导出.size} 字节；服务器文件名=${导出.name}`;
    结果.file = 目标;
    结果.rows = 校验.行数;
    return 结果;
  } catch (e) {
    结果.status = "异常";
    结果.detail = e.message;
    return 结果;
  } finally {
    if ((结果.status === "成功" || 结果.status === "文件校验失败") && session && !session.attached && !参数.keepOpen) {
      session.browser.close().catch(() => {});
    }
  }
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (参数.help || !参数.yearMonth) {
    console.log("用法：node src/tools/jd-魔方-客服销售分析-导出.js --year-month 2026-09 [--store jd1 ...] [--dry] [--out 目录] [--保持窗口]");
    process.exit(参数.help ? 0 : 2);
  }
  const 全部 = 全部店铺();
  const keys = 参数.stores.length ? 参数.stores : (读配置().mofangKeys || ["jd1", "jd3"]);
  const 店铺列表 = keys.map((k) => 全部.find((s) => s.key === k) || (() => { throw new Error(`未知店铺 ${k}`); })());
  const 输出目录 = 参数.out ? path.resolve(参数.out) : path.join(项目根, "runtime", "downloads", 参数.yearMonth);
  const { startDate, endDate } = 月末日期(参数.yearMonth);
  console.log(`31号 魔方·客服销售分析导出：${参数.yearMonth}（${startDate} ~ ${endDate}）`);
  console.log(`店铺：${店铺列表.map((s) => `${s.key}(${s.displayName})`).join("、")}`);
  console.log(`输出：${输出目录}`);
  if (参数.dry) return;

  fs.mkdirSync(输出目录, { recursive: true });
  const 报告 = [];
  for (const 店铺 of 店铺列表) {
    console.log(`\n—— ${店铺.key} ${店铺.displayName} ——`);
    const 结果 = await 跑一店(店铺, 参数, 输出目录);
    报告.push(结果);
    console.log(`   ${结果.status}：${结果.detail}`);
  }
  fs.writeFileSync(path.join(输出目录, "下载报告-魔方.json"), JSON.stringify({ 生成时间: new Date().toISOString(), 年月: 参数.yearMonth, 结果: 报告 }, null, 2), "utf8");
  const 成功 = 报告.filter((r) => r.status === "成功");
  // manifest-魔方：按店铺合并
  const manifest路径 = path.join(输出目录, "manifest-魔方.json");
  let 旧文件 = [];
  try {
    const 旧 = JSON.parse(fs.readFileSync(manifest路径, "utf8"));
    if (旧.年月 === 参数.yearMonth && Array.isArray(旧.files)) 旧文件 = 旧.files;
  } catch (e) { /* 首次 */ }
  const 本次keys = new Set(报告.map((r) => r.key));
  const 合并 = [...旧文件.filter((f) => !本次keys.has(f.key)), ...成功.map((r) => ({ file: r.file, store: r.displayName, key: r.key, rows: r.rows }))];
  fs.writeFileSync(manifest路径, JSON.stringify({ 年月: 参数.yearMonth, files: 合并 }, null, 2), "utf8");
  console.log(`\n成功 ${成功.length}/${报告.length} 店；manifest 已写：${manifest路径}`);
  const 要人 = 报告.filter((r) => ["需要登录", "导出失败", "文件校验失败"].includes(r.status));
  if (要人.length) {
    console.log("需要人工：");
    for (const r of 要人) console.log(`  · ${r.displayName}：${r.status}（${r.detail}）`);
  }
  process.exit(成功.length === 报告.length ? 0 : 2);
}

main().catch((e) => { console.error("失败：", e.message); process.exit(1); });
