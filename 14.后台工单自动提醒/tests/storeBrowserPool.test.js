// 常驻监控的浏览器池：一个店一个窗口、每轮复用、窗口没了才重新拉起、收工不关窗口、登记表串位也能找回本店窗口。
// 运行目录用 WORK_ORDER_HOME 隔离到临时目录，不碰正式 runtime；探测/身份判定用假实现注入。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "wo14-pool-"));
process.env.WORK_ORDER_HOME = home;

const { createStoreBrowserPool, loadPortRegistry } = require("../src/engine/storeBrowserPool");
const appConfig = require("../src/config/appConfig");

function makeStore(key, displayName) {
  return {
    key,
    displayName,
    sources: [{ key: "workorder", type: "jingxiWorkOrder", url: `https://example.com/${key}` }]
  };
}

// 假浏览器：isConnected() 用闭包变量控制，方便模拟"窗口被人关掉"。
function makeOpenImpl(state) {
  return async (options) => {
    state.calls.push(options);
    const session = {
      attached: false,
      port: options.reusePort || options.debugPort,
      browser: { isConnected: () => state.alive },
      context: {},
      closed: false,
      async close() {
        session.closed = true;
      }
    };
    state.session = session;
    return session;
  };
}

// 默认"没有活窗口"：避免测试撞上开发机上真开着的浏览器。
function makePool(state, overrides = {}) {
  return createStoreBrowserPool({
    openImpl: makeOpenImpl(state),
    probePortImpl: async () => null,
    profileMatcherImpl: () => false,
    ...overrides
  });
}

test("同一个店铺第二轮复用同一个窗口，不再开新窗口", async () => {
  const state = { calls: [], alive: true, session: null };
  const pool = makePool(state);
  const store = makeStore("jingxi2", "京喜2店");

  const first = await pool.ensure("jd", store);
  const second = await pool.ensure("jd", store);

  assert.strictEqual(state.calls.length, 1, "只允许拉起一次窗口");
  assert.strictEqual(first, second, "第二轮必须复用同一个会话");
  assert.strictEqual(state.calls[0].keepOpen, true, "常驻模式必须带 keepOpen（窗口不关）");
});

test("窗口被人关掉（连接断开）后重新拉起，而不是一直拿着死会话", async () => {
  const state = { calls: [], alive: true, session: null };
  const pool = makePool(state);
  const store = makeStore("jingxi2", "京喜2店");

  await pool.ensure("jd", store);
  state.alive = false; // 模拟人工关掉窗口 / 崩溃
  await pool.ensure("jd", store);

  assert.strictEqual(state.calls.length, 2, "窗口不在时必须重新拉起");
});

test("多个店铺各占一个调试端口，并把端口登记到 browser-ports.json", async () => {
  const state = { calls: [], alive: true, session: null };
  const pool = makePool(state);

  await pool.ensure("jd", makeStore("jdtest", "DEDAKJ器械店(测试)"));
  await pool.ensure("jd", makeStore("jingxi2", "京喜2店"));

  const ports = state.calls.map((item) => item.debugPort || item.reusePort);
  assert.strictEqual(new Set(ports).size, 2, `两个店铺不能共用一个端口：${ports.join(",")}`);

  const registry = loadPortRegistry();
  assert.strictEqual(registry["jd/jdtest"], ports[0]);
  assert.strictEqual(registry["jd/jingxi2"], ports[1]);
  assert.ok(fs.existsSync(appConfig.browserPortsPath), "端口登记表要落盘，重启后才能附着回原窗口");
});

test("重启后按登记表附着回原端口（reusePort 用登记值，不另开端口）", async () => {
  const state = { calls: [], alive: true, session: null };
  const pool = makePool(state);
  const store = makeStore("jingxi2", "京喜2店");

  await pool.ensure("jd", store);
  const firstPort = state.calls[0].debugPort;

  const state2 = { calls: [], alive: true, session: null };
  // 新进程重启：端口上就有本店窗口（活浏览器 + profile 匹配）→ 必须附着
  const pool2 = makePool(state2, {
    probePortImpl: async (port) => (port === firstPort ? { Browser: "Chrome" } : null),
    profileMatcherImpl: (port) => port === firstPort
  });
  await pool2.ensure("jd", store);

  assert.strictEqual(state2.calls[0].reusePort, firstPort, "新进程必须附着回原窗口端口");
  assert.strictEqual(state2.calls[0].debugPort, null, "能附着就不许再新拉起");
});

test("登记表串位（本店窗口在别的端口）也能找到并附着，不开新窗口、不误杀别的店", async () => {
  const state = { calls: [], alive: true, session: null };
  const pool = makePool(state, {
    // 只有 9413 上有活浏览器，且它就是本店 profile（模拟"这家店曾改用过别的端口"）
    probePortImpl: async (port) => (port === 9413 ? { Browser: "Chrome" } : null),
    profileMatcherImpl: (port) => port === 9413
  });
  const store = makeStore("jingxi2", "京喜2店");

  await pool.ensure("jd", store);

  assert.strictEqual(state.calls.length, 1, "已有本店窗口时不许重开");
  assert.strictEqual(state.calls[0].reusePort, 9413, "必须附着到本店窗口所在端口");
  assert.strictEqual(state.calls[0].debugPort, null, "能附着就不该再指定新拉起端口");
  assert.strictEqual(loadPortRegistry()["jd/jingxi2"], 9413, "附着后把真实端口写回登记表");
});

test("收工只断开引用，不关窗口（close 不杀浏览器）", async () => {
  const state = { calls: [], alive: true, session: null };
  const pool = makePool(state);
  await pool.ensure("jd", makeStore("jingxi2", "京喜2店"));

  await pool.detachAll();

  assert.strictEqual(state.session.closed, true, "会话要断开");
  assert.strictEqual(state.alive, true, "窗口本身要保持开着");
  assert.strictEqual(pool.sessions.size, 0, "池子要清空（下轮重新附着/拉起）");
});
