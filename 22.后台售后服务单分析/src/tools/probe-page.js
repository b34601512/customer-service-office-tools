#!/usr/bin/env node
// 探一页：把某个店铺窗口打到目标页面，抓「页面文本 + 界面渲染结构 + 期间所有 JSON 接口响应」，落盘成证据。
// 这是本项目的核心底层工具之一：只负责"把现场原样搬回来"，不做任何判漏处理业务判断（判断交给 AI）。
//
// 用法：
//   node src/tools/probe-page.js --platform tmall --store tmall1
//   node src/tools/probe-page.js --platform tmall --store tmall1 --url "https://qn.taobao.com/..." --seconds 20
//   node src/tools/probe-page.js --platform tmall --store tmall1 --attach        # 只附着已开窗口
//   node src/tools/probe-page.js --profile "D:\\..." --port 9429 --url "https://..."   # 临时探路
const fs = require("fs");
const path = require("path");
const { resolveStore, projectPath } = require("../config/stores");
const { openStoreBrowser, attachStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

function parseArgs(argv) {
  const args = { seconds: 15, keepOpen: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "attach") { args.attach = true; continue; }
    if (key === "no-keep-open") { args.keepOpen = false; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "seconds") args.seconds = Number(value);
    else if (key === "platform") args.platform = value;
    else if (key === "store") args.store = value;
    else if (key === "url") args.url = value;
    else if (key === "profile") args.profile = value;
    else if (key === "port") args.port = Number(value);
    else if (key === "click") args.click = value;
    else if (key === "eval") args.eval = value;
  }
  return args;
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function safeName(text, limit = 70) {
  return String(text).replace(/^https?:\/\//, "").replace(/[^0-9a-zA-Z._~-]+/g, "_").slice(0, limit) || "x";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile && !(args.platform && args.store)) {
    console.error("用法：node src/tools/probe-page.js --platform tmall --store tmall1 [--url ...] [--seconds 15] [--attach]");
    process.exit(2);
  }
  const store = args.profile
    ? { key: args.store || "temp", name: "临时探路", profileDir: path.resolve(args.profile), port: args.port || 9429, platformKey: args.platform || "temp" }
    : resolveStore(args);
  const url = args.url || store.backendUrl;
  if (!url) {
    console.error("没有目标 URL：请用 --url 指定，或在 stores.json 里给平台配 backendUrl。");
    process.exit(2);
  }

  const outDir = projectPath("runtime", "probe", `${stamp()}-${store.platformKey}-${store.key}`);
  fs.mkdirSync(path.join(outDir, "api"), { recursive: true });
  log("探针", "开始", `${store.platformKey}/${store.key}`, `url=${url}`, `attach=${Boolean(args.attach)}`);

  let session = null;
  if (args.attach) {
    session = await attachStoreBrowser({ profileDir: store.profileDir, port: store.port });
    if (!session) throw new Error(`端口 ${store.port} 上没有本店铺的窗口，无法附着（先用不带 --attach 的方式拉起）。`);
  } else {
    session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: url, debugPort: store.port, keepOpen: args.keepOpen });
  }

  const pages = session.context.pages().filter((page) => !page.isClosed());
  const host = (() => { try { return new URL(url).host; } catch (error) { return ""; } })();
  const page = pages.find((item) => { try { return host && new URL(item.url()).host === host; } catch (error) { return false; } })
    || pages[0]
    || await session.context.newPage();
  if (page.url() !== url && !page.url().startsWith(url.split("?")[0])) {
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch((error) => log("探针", "导航失败", error.message));
  }
  await page.bringToFront().catch(() => {});

  // 抓 JSON 接口响应：这是"后台数据怎么采集"的主战场（列表页通常靠接口分页取数）
  const captured = [];
  const onResponse = async (response) => {
    try {
      const contentType = String(response.headers()["content-type"] || "");
      if (!/json/i.test(contentType)) return;
      const body = await response.text();
      if (!body || body.length > 3 * 1024 * 1024) return;
      JSON.parse(body); // 不是 JSON 就跳过
      const index = captured.length + 1;
      const file = `${String(index).padStart(2, "0")}-${safeName(response.url())}.json`;
      fs.writeFileSync(path.join(outDir, "api", file), body, "utf8");
      captured.push({ file, url: response.url(), status: response.status(), method: response.request().method(), bytes: body.length });
    } catch (error) {
      // 抓包失败不影响探针主流程
    }
  };
  page.on("response", onResponse);

  // 记录**全部**请求（不只 JSON）：用来回答"数据到底是哪个接口给的"，避免只盯着一类响应瞎猜。
  const requests = [];
  page.on("response", (response) => {
    try {
      requests.push(`${response.status()} ${response.request().method()} ${String(response.headers()["content-type"] || "").split(";")[0]} ${response.url()}`);
    } catch (error) { /* 忽略 */ }
  });

  // 可选互动：点一个标签/按钮（只做筛选类点击，不改变业务数据）
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
    log("探针", "点击", args.click, clicked ? "已点击" : "没找到可点元素");
  }

  // 可选：跑一段只读 JS 看内部状态（例如列表接口是否把数据挂在 window 上）
  let evalResult = null;
  if (args.eval) {
    evalResult = await page.evaluate((code) => {
      try { return JSON.stringify(eval(code)); } catch (error) { return `ERR: ${error.message}`; }
    }, args.eval).catch((error) => `ERR: ${error.message}`);
    log("探针", "eval", String(evalResult).slice(0, 300));
  }

  log("探针", "等待页面数据", `观察 ${args.seconds} 秒`);
  await new Promise((resolve) => setTimeout(resolve, args.seconds * 1000));

  const snapshot = await page.evaluate(() => {
    const text = (document.body && document.body.innerText) ? document.body.innerText : "";
    return {
      url: location.href,
      title: document.title,
      text: text.slice(0, 20000),
      counts: {
        tableRows: document.querySelectorAll("table tr").length,
        trWithLinks: document.querySelectorAll("tr a").length,
        listItems: document.querySelectorAll("li").length,
        iframes: document.querySelectorAll("iframe").length,
        links: document.querySelectorAll("a").length
      }
    };
  }).catch((error) => ({ error: error.message, text: "", counts: {} }));

  const lines = [
    `# 探针结果 ${stamp()}`,
    "",
    `- 店铺：${store.platformKey}/${store.key}（${store.name || ""}）`,
    `- 目标 URL：${url}`,
    `- 实际 URL：${snapshot.url || page.url()}`,
    `- 标题：${snapshot.title || ""}`,
    `- 观察时长：${args.seconds} 秒`,
    `- 点击：${args.click || "（无）"}`,
    `- 抓到 JSON 响应：${captured.length} 个；全部请求：${requests.length} 条（见 requests.txt）`,
    evalResult ? `- eval 结果：\`${String(evalResult).slice(0, 500)}\`` : "",
    "",
    "## 抓到的 JSON 接口",
    "",
    ...(captured.length
      ? captured.map((item) => `- \`${item.method} ${item.status}\` ${item.bytes}B → \`api/${item.file}\`\n  - ${item.url}`)
      : ["- （无：可能是页面未登录、未加载列表，或数据不是 JSON）"]),
    "",
    "## 页面结构计数",
    "",
    `- table tr：${snapshot.counts?.tableRows ?? "-"}；tr 内链接：${snapshot.counts?.trWithLinks ?? "-"}；li：${snapshot.counts?.listItems ?? "-"}；a：${snapshot.counts?.links ?? "-"}；iframe：${snapshot.counts?.iframes ?? "-"}`,
    "",
    "## 页面文本（前 20000 字）",
    "",
    "```",
    snapshot.text || "(空)",
    "```",
    ""
  ];
  fs.writeFileSync(path.join(outDir, "summary.md"), lines.join("\n"), "utf8");
  fs.writeFileSync(path.join(outDir, "page-url.txt"), String(snapshot.url || page.url()), "utf8");
  fs.writeFileSync(path.join(outDir, "requests.txt"), requests.join("\n"), "utf8");
  fs.writeFileSync(path.join(outDir, "page.html"), await page.content().catch(() => ""), "utf8");

  log("探针", "完成", `输出目录 ${path.relative(projectPath(), outDir)}`, `JSON 响应 ${captured.length} 个`);
  console.log(`\n  页面标题：${snapshot.title || "(空)"}`);
  console.log(`  实际 URL：${snapshot.url || page.url()}`);
  console.log(`  JSON 响应：${captured.length} 个 → ${path.relative(projectPath(), path.join(outDir, "api"))}`);
  if (captured.length) {
    for (const item of captured.slice(0, 12)) console.log(`    · ${item.method} ${item.status} ${item.bytes}B ${item.url.slice(0, 130)}`);
  }
  console.log("");

  await session.close().catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  log("探针", "失败", error.stack || error.message);
  console.error(`\n  探针失败：${error.message}\n`);
  process.exit(1);
});
