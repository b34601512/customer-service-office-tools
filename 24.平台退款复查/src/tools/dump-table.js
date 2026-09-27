#!/usr/bin/env node
// 把一个列表页上的表格**原样结构化搬回来**：每行每列文本 + 每行的链接（含 href），落盘 JSON + Markdown 预览。
// 通用工具（不针对某个平台）：页面怎么渲染就怎么读，不做字段猜测、不做业务判断。
//
// 用法：
//   node src/tools/dump-table.js --platform tmall --store tmall1                 # 默认打开平台 backendUrl
//   node src/tools/dump-table.js --platform tmall --store tmall1 --attach        # 复用已开窗口（不重启、不动登录态）
//   node src/tools/dump-table.js --platform tmall --store tmall1 --click "退款待处理" --seconds 15
//   node src/tools/dump-table.js --platform tmall --store tmall1 --selector ".refund-table"
const fs = require("fs");
const path = require("path");
const { resolveStore, projectPath } = require("../config/stores");
const { openStoreBrowser, attachStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

function parseArgs(argv) {
  const args = { seconds: 12 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "attach") { args.attach = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "seconds") args.seconds = Number(value);
    else if (key === "platform") args.platform = value;
    else if (key === "store") args.store = value;
    else if (key === "url") args.url = value;
    else if (key === "profile") args.profile = value;
    else if (key === "port") args.port = Number(value);
    else if (key === "click") args.click = value;
    else if (key === "selector") args.selector = value;
  }
  return args;
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// 在页面里抓表格：默认挑"行数最多且可见"的那张表；每行给出单元格文本与链接。
const GRAB_TABLES = () => {
  const visible = (element) => Boolean(element && element.offsetParent !== null);
  const tables = Array.from(document.querySelectorAll("table")).filter((table) => visible(table));
  const info = tables.map((table) => ({ table, rows: table.querySelectorAll("tbody tr").length || table.querySelectorAll("tr").length }));
  info.sort((left, right) => right.rows - left.rows);
  return info.map((item) => {
    const headerRows = Array.from(item.table.querySelectorAll("thead tr"));
    const bodyRows = Array.from(item.table.querySelectorAll("tbody tr"));
    const rows = (bodyRows.length ? bodyRows : Array.from(item.table.querySelectorAll("tr")));
    return {
      rowCount: rows.length,
      headers: headerRows.flatMap((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => (cell.innerText || "").trim())),
      rows: rows.map((row) => {
        const cells = Array.from(row.querySelectorAll("td,th"));
        return {
          text: cells.map((cell) => (cell.innerText || "").replace(/\s+/g, " ").trim()),
          links: Array.from(row.querySelectorAll("a")).map((link) => ({ text: (link.innerText || "").trim().slice(0, 60), href: link.getAttribute("href") || link.href || "" })).slice(0, 8),
          raw: (row.innerText || "").replace(/\s+\n/g, "\n").trim().slice(0, 1200)
        };
      })
    };
  }).slice(0, 6);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile && !(args.platform && args.store)) {
    console.error("用法：node src/tools/dump-table.js --platform tmall --store tmall1 [--url ...] [--attach] [--click 文本] [--selector 选择器]");
    process.exit(2);
  }
  const store = args.profile
    ? { key: args.store || "temp", name: "临时探路", profileDir: path.resolve(args.profile), port: args.port || 9429, platformKey: args.platform || "temp" }
    : resolveStore(args);
  const url = args.url || store.backendUrl;
  const outDir = projectPath("runtime", "tables", `${stamp()}-${store.platformKey}-${store.key}`);
  fs.mkdirSync(outDir, { recursive: true });
  log("取表", "开始", `${store.platformKey}/${store.key}`, url ? `url=${url}` : "（附着当前页）");

  const session = args.attach || !url
    ? await attachStoreBrowser({ profileDir: store.profileDir, port: store.port })
    : await openStoreBrowser({ profileDir: store.profileDir, targetUrl: url, debugPort: store.port, keepOpen: true });
  if (!session) throw new Error(`端口 ${store.port} 上没有本店铺的窗口，无法附着（先跑一次 probe-page.js 拉起）。`);

  const pages = session.context.pages().filter((page) => !page.isClosed());
  const host = (() => { try { return new URL(url).host; } catch (error) { return ""; } })();
  const page = pages.find((item) => { try { return host && new URL(item.url()).host === host; } catch (error) { return false; } }) || pages[0];
  if (!page) throw new Error("没有可用页面。");
  if (!args.attach && url && page.url() !== url) await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.bringToFront().catch(() => {});

  if (args.click) {
    const clicked = await page.evaluate((target) => {
      const nodes = Array.from(document.querySelectorAll("button,a,div,span,li,label"));
      const exact = nodes.find((node) => (node.innerText || "").trim() === target && node.offsetParent !== null);
      const loose = nodes.find((node) => (node.innerText || "").trim().startsWith(target) && node.offsetParent !== null);
      const hit = exact || loose;
      if (!hit) return false;
      hit.click();
      return true;
    }, args.click).catch(() => false);
    log("取表", "点击", args.click, clicked ? "已点击" : "没找到可点元素");
  }

  await new Promise((resolve) => setTimeout(resolve, args.seconds * 1000));

  let tables = null;
  if (args.selector) {
    tables = [await page.evaluate((selector) => {
      const table = document.querySelector(selector);
      if (!table) return null;
      const rows = Array.from(table.querySelectorAll("tr"));
      return {
        rowCount: rows.length,
        headers: [],
        rows: rows.map((row) => ({
          text: Array.from(row.querySelectorAll("td,th")).map((cell) => (cell.innerText || "").replace(/\s+/g, " ").trim()),
          links: Array.from(row.querySelectorAll("a")).map((link) => ({ text: (link.innerText || "").trim().slice(0, 60), href: link.getAttribute("href") || "" })).slice(0, 8),
          raw: (row.innerText || "").trim().slice(0, 1200)
        }))
      };
    }, args.selector)];
  } else {
    tables = await page.evaluate(GRAB_TABLES);
  }
  const usable = (tables || []).filter(Boolean);
  const main = usable[0] || { rowCount: 0, headers: [], rows: [] };

  fs.writeFileSync(path.join(outDir, "tables.json"), JSON.stringify({ pageUrl: page.url(), title: await page.title(), tables: usable }, null, 2), "utf8");
  const md = [
    `# 列表搬运 ${stamp()}`,
    "",
    `- 页面：${await page.title()} ｜ ${page.url()}`,
    `- 表格数：${usable.length}；主表行数：${main.rowCount}`,
    `- 点击：${args.click || "（无）"}`,
    "",
    "## 主表行预览（每行原始文本）",
    "",
    ...main.rows.slice(0, 30).map((row, index) => `### 行 ${index + 1}\n\n\`\`\`\n${row.raw}\n\`\`\`\n`),
    ""
  ];
  fs.writeFileSync(path.join(outDir, "preview.md"), md.join("\n"), "utf8");

  console.log(`\n  主表行数：${main.rowCount}；表格数：${usable.length}`);
  console.log(`  输出：${path.relative(projectPath(), outDir)}（tables.json / preview.md）\n`);
  for (const row of main.rows.slice(0, 6)) {
    console.log(`    · ${row.raw.replace(/\n+/g, " | ").slice(0, 170)}`);
  }
  console.log("");
  await session.close().catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  log("取表", "失败", error.stack || error.message);
  console.error(`\n  取表失败：${error.message}\n`);
  process.exit(1);
});
