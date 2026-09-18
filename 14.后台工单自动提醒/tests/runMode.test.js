// 常驻模式（run）：演练模式不发送、窗口池被传递与复用、收工只断开不关窗口。
// 真发与浏览器都用假实现注入，跑的是同一条链路（与 #2705 的依赖注入约定一致）。
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

test("演练常驻：每轮都带 dryRun=true，且复用同一个窗口池", async () => {
  const pool = makeFakePool();
  const rounds = [];
  const loop = startMonitorLoop(null, {
    dryRun: true,
    sessionPool: pool,
    monitorOnceImpl: async (options) => {
      rounds.push(options);
      return { events: [], sent: 0, observations: {} };
    }
  });
  await settle();
  loop.stop();

  assert.strictEqual(rounds.length, 1, "启动后要立刻跑第一轮");
  assert.strictEqual(rounds[0].dryRun, true, "演练模式必须把 dryRun 传到 monitorOnce（否则会真发）");
  assert.strictEqual(rounds[0].sessionPool, pool, "同一轮的探测必须复用窗口池");
  assert.ok(pool.calls.ensured.length > 0, "启动时要先预热各店窗口");
  assert.strictEqual(pool.calls.detached, 1, "stop() 要断开引用（窗口本身不关）");
});

test("正常常驻：dryRun=false（真发路径），stop 后不再跑下一轮", async () => {
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
  assert.strictEqual(rounds[0].dryRun, false, "正常常驻就是要走真发路径");
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
