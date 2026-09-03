// 本文件负责页面探测：用店铺 profile 打开提醒源页面，读取页签计数。
// 依据 #623：接口有 h5st 签名不可外部复放，只能走「已登录浏览器 + DOM 文本」。
// 页签会随当前选中分类变化（实测 POP 某些页签下「可申诉」不直接展示）：
// 解析不到的 watch 页签就点一下对应区域，等 SPA 重渲染后再读一轮，只增不改避免跨时刻扯皮。

const { openStoreBrowser, resolveStoreProfileDir } = require("../../engine/chromeSession");
const { log } = require("../../engine/logger");
const { parseCounts, isLoginRedirect, looksLikeBrokenPage } = require("./textParser");
const { STATUS } = require("./alertPolicy");

const CLICK_SETTLE_MS = 1500;

async function readPageState(page, source) {
  const url = page.url();
  if (isLoginRedirect(url)) {
    return { status: STATUS.LOGIN_REQUIRED, counts: {}, url };
  }
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  return { status: STATUS.OK, counts: parseCounts(text, source.watch), text, url };
}

// 点缺失页签：页签文本形如「可申诉(1)」或「平台协同工单 (0)」，用前缀正则定位；点不到不致命，记日志。
async function clickMissingLabels(page, missingLabels) {
  for (const label of missingLabels) {
    try {
      const target = page.getByText(new RegExp(`^${label}[\\s（(]`)).first();
      await target.click({ timeout: 4000 });
      await new Promise((resolve) => setTimeout(resolve, CLICK_SETTLE_MS));
    } catch (error) {
      log("探测", label, "页签点击失败(降级为缺失)", String(error.message || error).slice(0, 120));
    }
  }
}

async function probeSource(page, source, pageLoadTimeoutMs) {
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: pageLoadTimeoutMs });
  const deadline = Date.now() + Math.max(pageLoadTimeoutMs, 30000);
  // 阶段1：等首次出数（SPA 页签计数异步水合）。
  let state = { status: STATUS.OK, counts: {} };
  while (Date.now() < deadline) {
    state = await readPageState(page, source);
    if (state.status === STATUS.LOGIN_REQUIRED) {
      return { status: state.status, counts: {}, url: state.url };
    }
    if (Object.keys(state.counts).length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (Object.keys(state.counts).length === 0) {
    if (looksLikeBrokenPage(state.text, source.watch)) {
      log("探测", source.url, "页面异常", "超时内未解析到任何页签计数");
    }
    return { status: STATUS.PAGE_ERROR, counts: {}, url: state.url };
  }
  // 阶段2：连续两次完全一致才采信（实测计数会先渲染 (0) 占位再异步更新，单读一次会抽风）。
  // 缺失页签先点开再读；仍缺失的 key 不写入（alertPolicy 对缺 key 不起事件）。
  let counts = { ...state.counts };
  let stablePrev = null;
  while (Date.now() < deadline) {
    const missing = source.watch.filter((label) => !(label in counts));
    if (missing.length > 0) {
      await clickMissingLabels(page, missing);
      const after = await readPageState(page, source);
      if (after.status === STATUS.LOGIN_REQUIRED) return { status: after.status, counts: {}, url: after.url };
      counts = { ...counts, ...pickMissing(after.counts, counts) };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const again = await readPageState(page, source);
    if (again.status === STATUS.LOGIN_REQUIRED) return { status: again.status, counts: {}, url: again.url };
    counts = { ...counts, ...again.counts };
    if (stablePrev && sameCounts(stablePrev, counts)) {
      return { status: STATUS.OK, counts, url: again.url };
    }
    stablePrev = { ...counts };
  }
  log("探测", source.url, "计数不稳定", "窗口内未连续两次一致，采用最后一次读数");
  return { status: STATUS.OK, counts, url: state.url };
}

function pickMissing(newCounts, known) {
  const out = {};
  for (const [label, value] of Object.entries(newCounts)) {
    if (!(label in known)) out[label] = value;
  }
  return out;
}

function sameCounts(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join("|") !== kb.join("|")) return false;
  return ka.every((k) => a[k] === b[k]);
}

// 一轮探测同一店铺的所有提醒源，共用一个浏览器，减少启动开销。
async function probeStore(platformKey, store, pageLoadTimeoutMs) {
  const profileDir = resolveStoreProfileDir(platformKey, store.key);
  const session = await openStoreBrowser({
    profileDir,
    targetUrl: store.sources[0] && store.sources[0].url
  });
  try {
    const results = {};
    for (const source of store.sources) {
      const page = await session.context.newPage();
      try {
        results[source.key] = await probeSource(page, source, pageLoadTimeoutMs);
        log("探测", `${store.displayName}/${source.key}`, results[source.key].status, JSON.stringify(results[source.key].counts));
      } catch (error) {
        log("探测", `${store.displayName}/${source.key}`, "异常", error.message);
        results[source.key] = { status: STATUS.PAGE_ERROR, counts: {}, error: error.message };
      } finally {
        await page.close().catch(() => {});
      }
    }
    return results;
  } finally {
    await session.close();
  }
}

module.exports = { probeStore, probeSource };
