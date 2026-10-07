#!/usr/bin/env node
// 31号：京东客服管家「促成订单」逐店导出（只读：只导航/查询/点导出/下载；不做任何写操作）。
//
// 数据链：xi.jd.com【咚咚查询→促成订单查询】页 → 页面内调 kf.jd.com/offlineDownload/addTask?type=2
//   （与点「导出excel」完全同一接口，parms=起始/结束日期）→ 轮询 getTaskStatus?type=2 →
//   拿到 storage.jd.com 签名下载地址 → 下载 xlsx 到 runtime/downloads/<年月>/。
//   · 不用点日期控件：导出接口直接吃 startTime/endTime，避开 antd 日历自动化。
//   · 登录态在店铺 profile 里（本项目专属 profile，2026-10-07 从 9号/22号 引导复制）。
//   · 单店登录失效/滑块验证码 → 留下可见窗口、跳过该店继续；失败不自动重试。
//
// 用法：
//   node src/tools/jd-客服管家-促成订单-导出.js --year-month 2026-09            # 全部 6 店
//   node src/tools/jd-客服管家-促成订单-导出.js --year-month 2026-09 --store jd1 --store jd3
//   node src/tools/jd-客服管家-促成订单-导出.js --year-month 2026-09 --dry      # 只看计划
//   可选：--out <目录>（默认 runtime/downloads/<年月>）、--保持窗口（成功店也不关窗口）
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { 全部店铺, 项目根 } = require("../config/stores");
const engine = require("../engine/browser");
const XLSX = require(path.resolve(项目根, "..", "9.客服数据自动更新", "node_modules", "xlsx"));

const 管家页 = "https://xi.jd.com/customerassistant/filterCustomer.html?menu=ddQuery&content=BringOrders";
const 必填源列 = ["咨询时间", "下单时间", "商品编号", "商品名称", "客服", "客户", "所属订单编号", "商品单价(?)", "购买数量", "订单状态"];

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
  return { startTime: `${年月}-01`, endTime: `${年月}-${String(末).padStart(2, "0")}` };
}

function 睡觉(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 页面内：建导出任务 + 轮询拿文件地址（与 UI 点「导出excel」同一套接口）
async function 页内导出(page, { startTime, endTime }) {
  return page.evaluate(async ({ startTime, endTime }) => {
    const 前次 = await fetch("https://kf.jd.com/offlineDownload/getTaskStatus?type=2", { credentials: "include" })
      .then((r) => r.text()).catch(() => "");
    let 前url = ""; try { 前url = JSON.parse(前次).url || ""; } catch (e) {}
    const parms = encodeURIComponent(JSON.stringify({ startTime, endTime }));
    const addRes = await fetch(`https://kf.jd.com/offlineDownload/addTask?type=2&parms=${parms}`, { credentials: "include" });
    const addBody = await addRes.text();
    let add = null; try { add = JSON.parse(addBody); } catch (e) {}
    if (!(add && String(add.success) === "1")) return { ok: false, step: "addTask", http: addRes.status, body: addBody.slice(0, 300) };
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 4000));
      const sBody = await fetch("https://kf.jd.com/offlineDownload/getTaskStatus?type=2", { credentials: "include" })
        .then((r) => r.text()).catch(() => "");
      let s = null; try { s = JSON.parse(sBody); } catch (e) {}
      if (s && Number(s.status) === 3 && s.url && s.url !== 前url) return { ok: true, url: s.url, 轮询次数: i + 1 };
    }
    return { ok: false, step: "poll", body: "等待 120 秒仍未拿到新文件地址" };
  }, { startTime, endTime });
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

function 校验xlsx(文件, 店铺) {
  const wb = XLSX.readFile(文件);
  const 页名 = wb.SheetNames.find((n) => n.includes("促成订单")) || wb.SheetNames[0];
  const 行 = XLSX.utils.sheet_to_json(wb.Sheets[页名], { header: 1, blankrows: false, raw: true });
  if (行.length < 2) return { ok: false, 原因: "文件没有数据行" };
  const 表头 = (行[0] || []).map((v) => String(v ?? "").trim());
  const 缺列 = 必填源列.filter((名) => !表头.includes(名));
  if (缺列.length) return { ok: false, 原因: `表头缺列：${缺列.join("、")}（实际：${表头.join("、")}）` };
  // 店铺校验：按客服昵称前缀投票，必须与配置一致
  const 前缀 = new Map();
  for (const 行数据 of 行.slice(1)) {
    const 昵称 = String(行数据[表头.indexOf("客服")] ?? "").replace(/[（(]推算[）)]$/, "").trim();
    const 段 = 昵称.split("--");
    const 头 = (段.length > 1 ? 段[0] : 昵称.split("-")[0]).trim().toLowerCase();
    if (头) 前缀.set(头, (前缀.get(头) || 0) + 1);
  }
  const 主前缀 = [...前缀.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const 期望 = String(店铺.nickPrefix || "").toLowerCase();
  if (期望 && 主前缀 !== 期望) {
    return { ok: false, 原因: `文件客服前缀是「${主前缀}」，与店铺「${店铺.displayName}」期望的「${店铺.nickPrefix}」不一致` };
  }
  return { ok: true, 行数: 行.length - 1, 表头 };
}

function 看窗口(session, 关) {
  if (!关) return;
  if (session.attached) return; // 复用别人的窗口不关
  session.browser.close().catch(() => {});
}

async function 跑一店(店铺, 参数, 输出目录) {
  const { startTime, endTime } = 月末日期(参数.yearMonth);
  const 结果 = { key: 店铺.key, displayName: 店铺.displayName, status: "", detail: "" };
  let session = null;
  try {
    session = await engine.openStoreBrowser({ profileDir: 店铺.profileDir, targetUrl: 管家页, debugPort: 店铺.port, keepOpen: true });
    const page = session.page || await engine.firstPage(session.context, 管家页);
    await page.bringToFront().catch(() => {});
    await page.waitForFunction(() => /促成订单|安全验证|验证码|滑动|登录/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
    await 睡觉(3000);

    const 当前url = page.url();
    const 文本 = await page.evaluate(() => document.body.innerText).catch(() => "");
    const 未登录 = /passport\.jd\.com|\/login/i.test(当前url) || /请登录|欢迎登录|账号登录|您没有该功能的操作权限/.test(文本) || !文本.trim();
    if (未登录) {
      结果.status = "需要登录";
      结果.detail = `未登录/无权限（${当前url}）`;
      // 把窗口留到登录页，方便人工登录一次（登录态之后会保存在本店 profile 里）
      const 登录页 = `https://passport.jd.com/new/login.aspx?ReturnUrl=${encodeURIComponent(管家页)}`;
      await page.goto(登录页, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.bringToFront().catch(() => {});
      return 结果;
    }
    if (/滑动|拖动|验证码|短信验证|安全验证|请完成验证/.test(文本)) {
      结果.status = "需要人工验证";
      结果.detail = "页面出现滑块/验证码/安全验证";
      return 结果;
    }
    if (!/促成订单查询/.test(文本)) {
      结果.status = "页面异常";
      结果.detail = `没看到「促成订单查询」，当前 URL=${当前url}，文本前 120 字：${文本.replace(/\s+/g, " ").slice(0, 120)}`;
      return 结果;
    }
    const 页头 = (文本.split("\n").map((s) => s.trim()).filter(Boolean)[0] || "");
    if (店铺.nickPrefix && !页头.toLowerCase().includes(店铺.nickPrefix.toLowerCase())) {
      结果.status = "店铺不匹配";
      结果.detail = `页面登录的是「${页头}」，期望前缀「${店铺.nickPrefix}」`;
      return 结果;
    }

    const 导出 = await 页内导出(page, { startTime, endTime });
    if (!导出.ok) {
      结果.status = "导出失败";
      结果.detail = `${导出.step}: ${导出.body}`;
      return 结果;
    }
    const 目标 = path.join(输出目录, `${店铺.key}_促成订单_${参数.yearMonth}.xlsx`);
    const 大小 = await 下载文件(导出.url, 目标);
    const 校验 = 校验xlsx(目标, 店铺);
    if (!校验.ok) {
      结果.status = "文件校验失败";
      结果.detail = 校验.原因;
      return 结果;
    }
    结果.status = "成功";
    结果.detail = `${校验.行数} 行，${大小} 字节`;
    结果.file = 目标;
    结果.rows = 校验.行数;
    结果.pin = 页头;
    return 结果;
  } catch (e) {
    结果.status = "异常";
    结果.detail = e.message;
    return 结果;
  } finally {
    if (结果.status === "成功" || 结果.status === "文件校验失败") 看窗口(session, !参数.keepOpen);
  }
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (参数.help || !参数.yearMonth) {
    console.log("用法：node src/tools/jd-客服管家-促成订单-导出.js --year-month 2026-09 [--store jd1 ...] [--dry] [--out 目录] [--保持窗口]");
    process.exit(参数.help ? 0 : 2);
  }
  const 店铺列表 = 参数.stores.length ? 参数.stores.map((k) => 全部店铺().find((s) => s.key === k) || (() => { throw new Error(`未知店铺 ${k}`); })()) : 全部店铺();
  const 输出目录 = 参数.out ? path.resolve(参数.out) : path.join(项目根, "runtime", "downloads", 参数.yearMonth);
  const { startTime, endTime } = 月末日期(参数.yearMonth);
  console.log(`31号 客服管家·促成订单导出：${参数.yearMonth}（${startTime} ~ ${endTime}）`);
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
  fs.writeFileSync(path.join(输出目录, "下载报告-管家.json"), JSON.stringify({ 生成时间: new Date().toISOString(), 年月: 参数.yearMonth, 结果: 报告 }, null, 2), "utf8");
  const 成功 = 报告.filter((r) => r.status === "成功");
  // manifest 按店铺合并（同一店重跑只替换该店；--store 单店跑不会把其它店挤掉）
  const manifest路径 = path.join(输出目录, "manifest.json");
  let 旧文件 = [];
  try {
    const 旧 = JSON.parse(fs.readFileSync(manifest路径, "utf8"));
    if (旧.年月 === 参数.yearMonth && Array.isArray(旧.files)) 旧文件 = 旧.files;
  } catch (e) { /* 首次 */ }
  const 本次keys = new Set(报告.map((r) => r.key));
  const 合并 = [...旧文件.filter((f) => !本次keys.has(f.key)), ...成功.map((r) => ({ file: r.file, store: r.displayName, key: r.key, rows: r.rows }))];
  fs.writeFileSync(manifest路径, JSON.stringify({
    年月: 参数.yearMonth,
    files: 合并
  }, null, 2), "utf8");
  console.log(`\n成功 ${成功.length}/${报告.length} 店；manifest 已写：${path.join(输出目录, "manifest.json")}`);
  const 要人 = 报告.filter((r) => ["需要登录", "需要人工验证", "店铺不匹配", "页面异常"].includes(r.status));
  if (要人.length) {
    console.log("需要人工：");
    for (const r of 要人) console.log(`  · ${r.displayName}：${r.status}（${r.detail}）`);
  }
  process.exit(成功.length === 报告.length ? 0 : 2);
}

main().catch((e) => { console.error("失败：", e.message); process.exit(1); });
