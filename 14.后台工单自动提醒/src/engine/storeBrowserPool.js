// 本文件负责常驻监控的店铺浏览器池：一个店铺一个窗口，启动时拉起（或附着已经开着的那个），
// 之后每一轮都复用同一个窗口 —— 窗口不关、登录态不丢，用户也能随时看着页面。
// 只修工具自身（窗口被人关掉/崩了就重新拉起），不涉及任何"重复请求平台数据"的自动重试。

const appConfig = require("../config/appConfig");
const { readJson, writeJsonAtomic } = require("./fileSystem");
const { log } = require("./logger");
const { isPortFree, openStoreBrowser, resolveStoreProfileDir } = require("./chromeSession");

function keyOf(platformKey, storeKey) {
  return `${platformKey}/${storeKey}`;
}

function loadPortRegistry() {
  return readJson(appConfig.browserPortsPath, {});
}

function savePortRegistry(registry) {
  writeJsonAtomic(appConfig.browserPortsPath, registry);
}

// 每个店铺分配一个固定调试端口（记在 browser-ports.json）：重启后能附着回原窗口。
async function resolveStorePort(registry, key) {
  const others = new Set(Object.entries(registry).filter(([k]) => k !== key).map(([, port]) => port));
  if (registry[key] && !others.has(registry[key])) return registry[key];
  let port = appConfig.baseDebugPort;
  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = port + offset;
    if (!others.has(candidate) && (await isPortFree(candidate))) {
      registry[key] = candidate;
      savePortRegistry(registry);
      return candidate;
    }
  }
  throw new Error(`店铺 ${key} 找不到可用调试端口（${appConfig.baseDebugPort} 起 20 个都被占用）。`);
}

// openImpl / probeDebugPortImpl 仅作依赖注入点：测试可用假实现跑同一条链路。
function createStoreBrowserPool(options = {}) {
  const openImpl = options.openImpl || openStoreBrowser;
  const sessions = new Map();

  async function ensure(platformKey, store) {
    const key = keyOf(platformKey, store.key);
    const existing = sessions.get(key);
    if (existing && existing.browser.isConnected()) return existing;
    if (existing) {
      // 窗口被人工关掉或崩了：这是工具自身故障，允许重新拉起（与"平台失败不自动重试"无关）。
      log("浏览器", store.displayName, "上一轮的窗口已不在", `key=${key}，重新拉起`);
      sessions.delete(key);
    }
    const registry = loadPortRegistry();
    const port = await resolveStorePort(registry, key);
    const profileDir = resolveStoreProfileDir(platformKey, store.key);
    const session = await openImpl({
      profileDir,
      targetUrl: store.sources[0] && store.sources[0].url,
      keepOpen: true,
      reusePort: port
    });
    if (session.port && session.port !== port) {
      // 附着失败走新拉起时端口可能顺延，把真实端口写回登记表，下次才能附着。
      registry[key] = session.port;
      savePortRegistry(registry);
    }
    sessions.set(key, session);
    return session;
  }

  function get(platformKey, store) {
    return sessions.get(keyOf(platformKey, store.key));
  }

  // 收工：只断开引用，**不关窗口**（用户要窗口一直开着）。
  async function detachAll() {
    for (const [key, session] of sessions) {
      try {
        await session.close();
      } catch (error) {
        log("浏览器", "会话", "断开失败", `${key}：${error.message}`);
      }
    }
    sessions.clear();
  }

  return { ensure, get, detachAll, sessions };
}

module.exports = { createStoreBrowserPool, loadPortRegistry, savePortRegistry };
