const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDouyinSharedBrowserSession
} = require("../src/platforms/douyin/douyinCollectionSession");

test("抖音同一批次只启动一个共享浏览器，人工接管后沿用有头模式", async () => {
  const openedModes = [];
  let closeCount = 0;
  const session = createDouyinSharedBrowserSession({
    browserMode: "hybrid",
    closeBrowser: async () => {
      closeCount += 1;
    }
  });

  assert.equal(await session.ensureStarted(async (mode) => openedModes.push(mode)), true);
  assert.equal(await session.ensureStarted(async (mode) => openedModes.push(mode)), false);
  assert.deepEqual(openedModes, ["hybrid"]);
  assert.equal(session.isStarted, true);

  await session.rebuildHeaded(async (mode) => openedModes.push(mode));
  assert.equal(session.browserMode, "headed");
  assert.deepEqual(openedModes, ["hybrid", "headed"]);

  assert.equal(await session.close(), undefined);
  assert.equal(await session.close(), false);
  assert.equal(closeCount, 1);
  assert.equal(session.isStarted, false);
});
