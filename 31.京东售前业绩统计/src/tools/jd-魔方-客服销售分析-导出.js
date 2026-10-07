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
const https = require("node:https");
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

// 页面内：找当前页面的 Vue 组件，设置日期，调它自己的 exportExcelTask，再轮询导出记录
async function 页内导出(page, { startDate, endDate }) {
  return page.evaluate(async ({ startDate, endDate }) => {
    const 找组件 = (vm) => {
      if (vm && vm.$options && vm.$options.methods && vm.$options.methods.exportExcelTask) return vm;
      for (const c of ((vm && vm.$children) || [])) { const hit = 找组件(c); if (hit) return hit; }
      return null;
    };
    const token = localStorage.getItem("token") || new URLSearchParams(location.search).get("token") || "";
    if (!token) return { ok: false, step: "login", message: "localStorage 里没有 token" };
    const 根 = document.querySelector("#app") && document.querySelector("#app").__vue__;
    if (!根) return { ok: false, step: "vue", message: "找不到 #app 的 Vue 实例" };
    let vm = null;
    for (let i = 0; i < 60; i += 1) {
      vm = 找组件(根);
      if (vm && vm.form && vm.form.shop && vm.form.shop.shopId) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!vm) return { ok: false, step: "vue", message: "找不到带 exportExcelTask 的页面组件" };
    if (!(vm.form && vm.form.shop && vm.form.shop.shopId)) return { ok: false, step: "vue", message: "页面店铺信息还没就绪" };

    vm.form.daterange = [startDate, endDate];
    const 前id = vm.exportCenter && vm.exportCenter.exportId ? vm.exportCenter.exportId : "";
    vm.exportExcelTask();
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      const 现id = vm.exportCenter && vm.exportCenter.exportId ? vm.exportCenter.exportId : "";
      if (现id && 现id !== 前id) break;
    }
    const exportId = vm.exportCenter && vm.exportCenter.exportId ? vm.exportCenter.exportId : "";
    if (!exportId) return { ok: false, step: "task", message: "建导出任务后没拿到 exportId" };

    const shopId = vm.form.shop.shopId;
    const post = (p, d) => fetch("https://gwjoyi.yiyitech.com/web-report" + p, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: token },
      body: new URLSearchParams(d).toString()
    }).then((r) => r.json());
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      let res = null;
      try { res = await post("/task/export/selectByShopIdExportLst", { shopId }); } catch (e) { res = null; }
      if (!res) continue;
      if (res.rpCode) return { ok: false, step: "api", message: `${res.rpCode} ${res.rpMsg || ""}` };
      const 表 = res.exportRecordLst || [];
      const 命中 = 表.find((r) => String(r.id) === String(exportId)) || 表.find((r) => r.name && r.name.indexOf("客服销售分析") + 1 && r.status !== 1);
      if (命中 && 命中.url && 命中.status !== 1) return { ok: true, url: 命中.url, name: 命中.name, exportId, shopId };
    }
    return { ok: false, step: "poll", message: "等待导出文件超时（180 秒）" };
  }, { startDate, endDate });
}

function 下载文件(url, 目标) {
  return new Promise((resolve, reject) => {
    const 全url = url.startsWith("http") ? url : `https://${url}`;
    const 请求 = https.get(全url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 120000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return 下载文件(res.headers.location, 目标).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`下载 HTTP ${res.statusCode}`)); }
      const 流 = fs.createWriteStream(目标);
      res.pipe(流);
      流.on("finish", () => { 流.close(() => resolve(fs.statSync(目标).size)); });
      流.on("error", reject);
    });
    请求.on("timeout", () => { 请求.destroy(new Error("下载超时")); });
    请求.on("error", reject);
  });
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
    const 有token = await page.evaluate(() => Boolean(localStorage.getItem("token"))).catch(() => false);
    const 像登录页 = /passport\.jd\.com|\/login/i.test(当前url) || /登录|授权/.test(文本) && !/客服销售分析/.test(文本);
    if (!有token || 像登录页) {
      结果.status = "需要登录";
      结果.detail = `魔方未授权（token=${有token ? "有" : "无"}，url=${当前url}）`;
      const 授权页 = `${OAuth入口}${Date.now()}`;
      await page.goto(授权页, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.bringToFront().catch(() => {});
      return 结果;
    }

    const 导出 = await 页内导出(page, { startDate, endDate });
    if (!导出.ok) {
      if (导出.step === "login" || 导出.step === "api") {
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
    const 目标 = path.join(输出目录, `${店铺.key}_客服销售分析_${参数.yearMonth}.xlsx`);
    const 大小 = await 下载文件(导出.url, 目标);
    const 校验 = 校验xlsx(目标);
    if (!校验.ok) {
      结果.status = "文件校验失败";
      结果.detail = 校验.原因;
      return 结果;
    }
    结果.status = "成功";
    结果.detail = `${校验.行数} 行，${大小} 字节；服务器文件名=${导出.name}`;
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
