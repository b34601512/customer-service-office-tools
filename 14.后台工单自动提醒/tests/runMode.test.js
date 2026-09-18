// 常驻模式（run）：窗口池被传递与复用、stop 后不再巡检、收工只断开不关窗口。
// 企微发送与浏览器都用假实现注入，跑的是同一条链路（与 #2705 的依赖注入约定一致）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "wo14-run-"));
process.env.WORK_ORDER_HOME = home;

const { startMonitorLoop } = require("../src/features/workOrderMonitor/service");

function makeFakePool() {
  const calls = { ensured: [], detached: 0 };
  return {
    calls,
    async ensure(platformKey, store) {
      calls.ensured.push(`${platformKey}/${store.key}`);
      return { browser: { isConnected: () => true }, context: {} };
    },
    async detachAll() {
      calls.detached += 1;
    }
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

test("常驻监控：每轮带上可复用的窗口池，启动时先预热各店窗口，stop 只断引用不关窗口", async () => {
  const pool = makeFakePool();
  const rounds = [];
  const loop = startMonitorLoop(null, {
    sessionPool: pool,
    monitorOnceImpl: async (options) => {
      rounds.push(options);
      return { events: [], sent: 0, observations: {} };
    }
  });
  await settle();
  loop.stop();

  assert.strictEqual(rounds.length, 1, "启动后要立刻跑第一轮");
  assert.strictEqual(rounds[0].sessionPool, pool, "同一轮的探测必须复用窗口池");
  assert.ok(pool.calls.ensured.length > 0, "启动时要先预热各店窗口");
  assert.strictEqual(pool.calls.detached, 1, "stop() 要断开引用（窗口本身不关）");
});

test("常驻监控：stop 后不再跑下一轮", async () => {
  const pool = makeFakePool();
  const rounds = [];
  const loop = startMonitorLoop(null, {
    sessionPool: pool,
    monitorOnceImpl: async (options) => {
      rounds.push(options);
      return { events: [], sent: 0, observations: {} };
    }
  });
  await settle();
  loop.stop();
  await settle();
  assert.strictEqual(rounds.length, 1, "stop() 之后不许再触发巡检");
});

test("预热窗口失败不阻断巡检（单店失败隔离）", async () => {
  const pool = makeFakePool();
  pool.ensure = async (platformKey, store) => {
    throw new Error(`窗口拉不起来：${store.key}`);
  };
  const rounds = [];
  const loop = startMonitorLoop(null, {
    sessionPool: pool,
    monitorOnceImpl: async (options) => {
      rounds.push(options);
      return { events: [], sent: 0, observations: {} };
    }
  });
  await settle();
  loop.stop();
  assert.strictEqual(rounds.length, 1, "某个店窗口预热失败，其他店仍要巡检");
});
