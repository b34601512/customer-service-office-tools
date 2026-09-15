// 2026-09-15 实录：9号整轮汇总在“等待拼多多下载落盘”阶段静默卡死 43 分钟——
// 只发出一行「等待文件落盘」，之后再无任何输出，既不报错也不推进，直到外部看门狗把它杀掉。
// 根因：人工等待时间不计入 automation time，只要人工守卫反复耗时，
//       “60 秒没有检测到新文件”的自然超时就可以被无限推迟。
// 本测试锁定修复后的行为：墙钟上限到达必须收敛为可见失败（返回 null），绝不无限等待。
const assert = require("assert");
const { runInAutomationScope } = require("../src/engine/browserAutomationScope");
const { waitForDownloadArtifactState } = require("../src/shared/downloadEventEngine");

async function main() {
  let clock = 0;
  let readCalls = 0;
  const scope = {
    headless: false,
    humanTimeoutMs: 500,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    isShutdownRequested: () => false,
    onProgress: () => {}
  };

  const result = await runInAutomationScope(scope, async () => {
    const readArtifact = async () => {
      readCalls += 1;
      // 每次轮询都模拟“人工守卫吃掉墙钟时间”，并被记入 humanWaitMs：
      // 此时 getAutomationTime() 永远停在 0，只有墙钟上限能终止循环。
      clock += 100;
      scope.humanWaitMs = (scope.humanWaitMs || 0) + 100;
      return null;
    };
    return waitForDownloadArtifactState(readArtifact, 50, 20);
  });

  assert.strictEqual(result, null, "墙钟上限到达后必须返回 null（可见失败），不能无限等待");
  assert.ok(readCalls > 1, "必须真的轮询过产物状态");
  assert.ok(readCalls < 200, `轮询次数必须有界，实际=${readCalls}`);

  // 正常命中时仍然立即返回，不受墙钟上限影响。
  let once = 0;
  const hit = await runInAutomationScope(scope, () =>
    waitForDownloadArtifactState(async () => (++once < 2 ? null : { file: "hit.xlsx" }), 2000, 20)
  );
  assert.deepStrictEqual(hit, { file: "hit.xlsx" });

  console.log("PASS downloadWaitWallClockCap：人工等待不再让下载等待无限延长，且正常命中不受影响");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
