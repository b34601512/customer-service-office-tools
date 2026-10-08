#!/usr/bin/env node
// 32号 补差费用申请：把源表「支付宝/微信账号」列（G 列）的**单元格图片**（=DISPIMG("ID_…",1)）
// 导出为本机图片 + dataURL（给目标表 AirScript v5「插图」动作用）。
//
// 原理（2026-10-08 实测，只读）：
//   1) 匿名无头打开源表；单元格图片在隐藏表 `WpsReserved_CellImgList` 里以形状（shape）形式存放，
//      `shape.shapeData.name` = DISPIMG ID、`shape._attachmentId` = 附件 ID（附件形态）；
//   2) `window.APP._imageManager.getAttachmentImageInfo(附件ID)` → 返回 `_100`（原尺寸）图片
//      的 CDN 签名 URL；fetch 后转 base64 dataURL（无需登录/令牌）。
//   3) 非附件（新版）单元格图片：回退 `getImageUrl(DISPIMG ID)`（sha1 形态 CDN）。
//   全程只读：不输入、不点保存、不触发同步。
//
// 用法：
//   node scripts/导出收款码图.cjs --清单 runtime/tmp/收款码清单.json --出 runtime/收款码图/2026-10-08
//   清单 JSON：[{"行":451,"姓名":"程小霞","id":"ID_352FA1A825414A33B3C550B97EAE6B0C"}, …]
//   输出：<出>/<行>-<姓名>.<ext>（原格式 jpg/png/webp）+ <出>/dataURL.json
//   （含 行/姓名/id/附件ID/文件/字节/mime/宽高/dataURL）；失败退出码 1，**不自动重试**（用户铁律）。
const fs = require("node:fs");
const path = require("node:path");
const { resolveBrowserPath } = require("../../tools/金山表/读表核心.js");

const 项目根 = path.resolve(__dirname, "..");

function 解析参数(argv) {
  const 出 = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k.slice(0, 2) === "--") 出[k.slice(2)] = argv[i + 1] && argv[i + 1].slice(0, 2) !== "--" ? argv[++i] : true;
  }
  return 出;
}

function 加载playwright() {
  const 候选 = [
    path.join(项目根, "node_modules", "playwright-core"),
    path.join(项目根, "..", "24.平台退款复查", "node_modules", "playwright-core"),
    path.join(项目根, "..", "1.客服超时督办", "node_modules", "playwright-core")
  ];
  for (const p of 候选) {
    try { return require(p); } catch (错误) { /* 继续找 */ }
  }
  throw new Error("找不到 playwright-core（32号没有 node_modules，尝试过 24号/1号）");
}

function 读链接(key) {
  const 配置 = JSON.parse(fs.readFileSync(path.join(项目根, "project-config", "links.local.json"), "utf8"));
  const url = String(配置[key] || "").trim();
  if (!url) throw new Error(`links.local.json 里没有「${key}」`);
  return url;
}

// 从图片二进制头部读宽高（PNG/JPEG/GIF/WebP）
function 读图片尺寸(buf, mime) {
  try {
    if (mime.includes("png") && buf.length > 24) return { 宽: buf.readUInt32BE(16), 高: buf.readUInt32BE(20) };
    if (mime.includes("gif") && buf.length > 10) return { 宽: buf.readUInt16LE(6), 高: buf.readUInt16LE(8) };
    if (mime.includes("jpeg")) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const 标记 = buf[i + 1];
        const 长 = buf.readUInt16BE(i + 2);
        if (标记 >= 0xc0 && 标记 <= 0xcf && 标记 !== 0xc4 && 标记 !== 0xc8 && 标记 !== 0xcc) {
          return { 高: buf.readUInt16BE(i + 5), 宽: buf.readUInt16BE(i + 7) };
        }
        i += 2 + 长;
      }
    }
    if (mime.includes("webp") && buf.length > 30) {
      if (buf.slice(12, 16).toString() === "VP8X") return { 宽: 1 + buf.readUIntLE(24, 3), 高: 1 + buf.readUIntLE(27, 3) };
    }
  } catch (错误) { /* 读不到宽高不算失败 */ }
  return {};
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const 参 = 解析参数(process.argv.slice(2));
  const 清单路径 = String(参.清单 || "");
  const 出目录 = path.resolve(String(参.出 || path.join(项目根, "runtime", "收款码图", "未命名")));
  if (!清单路径 || !fs.existsSync(清单路径)) {
    console.error("用法：node scripts/导出收款码图.cjs --清单 <json> --出 <目录>");
    process.exitCode = 2;
    return;
  }
  const 清单 = JSON.parse(fs.readFileSync(path.resolve(清单路径), "utf8"));
  const 项 = (Array.isArray(清单) ? 清单 : 清单.项 || []).map((x) => ({
    行: Number(x.行), 姓名: String(x.姓名 || ""), id: String(x.id || "")
  })).filter((x) => x.id);
  if (!项.length) { console.error("清单里没有带 id 的项"); process.exitCode = 2; return; }
  fs.mkdirSync(出目录, { recursive: true });

  const url = 读链接("补差登记总表");
  const { chromium } = 加载playwright();
  const browser = await chromium.launch({
    executablePath: resolveBrowserPath(),
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, locale: "zh-CN" });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const 关弹层 = page.locator("#util-popup .wps-login-panel__header__right button");
    if (await 关弹层.count()) await 关弹层.first().click({ timeout: 5000 }).catch(() => {});
    const 截止 = Date.now() + 60000;
    let 就绪 = false;
    while (Date.now() < 截止) {
      就绪 = await page.evaluate(() => Boolean(
        window.APP && window.APP._imageManager &&
        window.APP.workbook && typeof window.APP.workbook.getWorksheets === "function"
      )).catch(() => false);
      if (就绪) break;
      await sleep(1000);
    }
    if (!就绪) throw new Error("60 秒内页面运行时没就绪（APP._imageManager / workbook）");

    // 打开隐藏表拿 DISPIMG ID → 形状（附件 ID）映射
    const 映射 = await page.evaluate(async () => {
      const 表册 = window.APP.workbook.getWorksheets();
      const 表 = 表册.getItemByName("WpsReserved_CellImgList");
      if (!表) return { 错误: "没有隐藏表 WpsReserved_CellImgList" };
      if (表.activate) await 表.activate();
      await new Promise((r) => setTimeout(r, 1500));
      const live = 表册.getItemByName("WpsReserved_CellImgList");
      await live.loadSheetData();
      const 形状 = live.getShapes() || [];
      const 出 = {};
      for (let i = 0; i < 形状.length; i += 1) {
        const sh = 形状[i];
        let 名 = "";
        try { 名 = String((sh.shapeData && sh.shapeData.name) || ""); } catch (e) { 名 = ""; }
        // 实测：shapeData.name 直接读拿不到，从序列化串里抠 "name":"ID_…"（探图9/10 验证）
        if (!名) {
          try {
            const m = JSON.stringify(sh.shapeData || "").match(/"name":"(ID_[0-9A-F]+)"/);
            名 = m ? m[1] : "";
          } catch (e2) { 名 = ""; }
        }
        if (!名) continue;
        let 附件 = "";
        try { 附件 = String(sh._attachmentId || ""); } catch (e) { 附件 = ""; }
        let 是附件 = false;
        try { 是附件 = Boolean(sh.getIsAttachment && sh.getIsAttachment()); } catch (e) { 是附件 = Boolean(附件); }
        出[名] = { 附件ID: 附件, 是附件: 是附件 };
      }
      return { 形状数: 形状.length, 映射: 出 };
    });
    if (映射.错误) throw new Error(映射.错误);
    console.log(`隐藏表形状 ${映射.形状数} 个，映射 ${Object.keys(映射.映射).length} 个 ID`);

    // 逐项取图（页面里拿签名 URL → fetch → base64）
    const 结果 = [];
    for (const 一 of 项) {
      const 形 = 映射.映射[一.id];
      if (!形) { console.error(`✗ 行${一.行} ${一.姓名} 隐藏表里没有这个图片 ID`); 结果.push({ ...一, 错误: "映射里没有该 ID" }); continue; }
      const r = await page.evaluate(async ({ id, 附件ID }) => {
        try {
          const im = window.APP._imageManager;
          let url = "";
          let 途径 = "";
          if (附件ID) {
            try {
              const info = await im.getAttachmentImageInfo(附件ID);
              url = String((info && info.url) || "");
              途径 = "附件";
            } catch (e1) { url = ""; }
          }
          if (!url) {
            try { url = String((await im.getImageUrl(id)) || ""); 途径 = "DISPIMG"; } catch (e2) { url = ""; }
          }
          if (!url) return { 错误: "没有取到图片 URL（附件/DISPIMG 两条路都空）" };
          const resp = await fetch(url);
          if (!resp.ok) return { 错误: `fetch 状态 ${resp.status}（途径 ${途径}）` };
          const mime = String(resp.headers.get("content-type") || "image/png").split(";")[0];
          const buf = new Uint8Array(await resp.arrayBuffer());
          let 二进制 = "";
          for (let i = 0; i < buf.length; i += 8192) {
            二进制 += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
          }
          return { 途径, mime, 字节: buf.length, dataURL: `data:${mime};base64,${btoa(二进制)}` };
        } catch (e) {
          return { 错误: String(e.message || e).slice(0, 300) };
        }
      }, { id: 一.id, 附件ID: 形.附件ID });
      if (r.错误) { console.error(`✗ 行${一.行} ${一.姓名} ${r.错误}`); 结果.push({ ...一, 附件ID: 形.附件ID, 错误: r.错误 }); continue; }
      const 后缀 = r.mime.includes("jpeg") ? "jpg" : r.mime.includes("webp") ? "webp" : r.mime.includes("gif") ? "gif" : "png";
      const buf = Buffer.from(String(r.dataURL).split(",")[1], "base64");
      const 文件名 = `${一.行}-${一.姓名 || "无姓名"}.${后缀}`;
      fs.writeFileSync(path.join(出目录, 文件名), buf);
      const 尺寸 = 读图片尺寸(buf, r.mime);
      console.log(`✓ 行${一.行} ${一.姓名} → ${文件名}（${r.字节} 字节，${r.mime}${尺寸.宽 ? `，${尺寸.宽}x${尺寸.高}` : ""}，途径 ${r.途径}）`);
      结果.push({ 行: 一.行, 姓名: 一.姓名, id: 一.id, 附件ID: 形.附件ID, 文件: 文件名, 字节: r.字节, mime: r.mime, ...尺寸, 途径: r.途径, dataURL: r.dataURL });
    }
    fs.writeFileSync(path.join(出目录, "dataURL.json"), JSON.stringify(结果, null, 1));
    const 失败 = 结果.filter((x) => x.错误).length;
    console.log(`\n完成：成功 ${结果.length - 失败} / 共 ${结果.length}；输出目录 ${出目录}`);
    if (失败) process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error("崩溃:", e.message || e); process.exitCode = 1; });
