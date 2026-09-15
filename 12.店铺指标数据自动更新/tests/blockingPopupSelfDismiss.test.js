const test = require("node:test");
const assert = require("node:assert/strict");
const { dismissBlockingPopups } = require("../src/shared/blockingPopupEngine");

// 背景（2026-09-15 实跑）：京东3店整店失败在「点击唯一明确关闭入口」超时。
// 真实原因是关闭按钮带动画/继交层导致 Playwright 判定元素不稳定，
// 而弹层此时已经自行消失。关闭目标已达成却让整店失败，属于可收敛的竞态。
class FakePopupElementHandle {
  constructor(surface) {
    this.surface = surface;
    this.evaluateCalls = 0;
  }

  async evaluate() {
    this.evaluateCalls += 1;
    if (this.evaluateCalls === 1) {
      // readPopupSignature：点击前读取弹层签名。
      return { className: "fake-popup", text: "限时活动", visible: true };
    }
    // isPopupStillInPage：点击失败后判断弹层是否仍在页面中。
    return this.surface.popupStillInPage;
  }

  async dispose() {}
}

class FakeCloseTarget {
  constructor(surface) {
    this.surface = surface;
  }

  async click() {
    this.surface.clickAttempts += 1;
    this.surface.popupStillInPage = this.surface.popupSurvivesClick;
    if (!this.surface.popupSurvivesClick) {
      // 真实弹层已经消失：后续扫描不应再检测到它。
      this.surface.popupVisible = false;
    }
    throw new Error("locator.click: Timeout 5000ms exceeded.");
  }
}

function createFakeSurface(options = {}) {
  return {
    popupVisible: true,
    popupStillInPage: true,
    popupSurvivesClick: options.popupSurvivesClick === true,
    clickAttempts: 0,
    waitForTimeout: async () => {},
    locator(selector) {
      const isDialogLocator = String(selector).includes("role='dialog'");
      const surface = this;
      return {
        async count() {
          if (isDialogLocator) return surface.popupVisible ? 1 : 0;
          return 1;
        },
        first() {
          return this;
        },
        async elementHandle() {
          return new FakePopupElementHandle(surface);
        },
        locator() {
          return {
            async count() {
              return 1;
            },
            first() {
              return new FakeCloseTarget(surface);
            }
          };
        }
      };
    }
  };
}

test("弹层在关闭点击期间自行消失：按已关闭继续，不抛错", async () => {
  const surface = createFakeSurface({ popupSurvivesClick: false });
  const closedCount = await dismissBlockingPopups(surface, {
    platformName: "京东",
    popupIdleTimeoutMs: 0,
    popupPollIntervalMs: 1
  });
  assert.equal(surface.clickAttempts, 1, "必须尝试过一次唯一明确关闭入口");
  assert.equal(closedCount, 1, "弹层已消失时按已关闭计数");
});

test("关闭点击超时但弹层仍在页面：必须继续抛出，不静默吞掉", async () => {
  const surface = createFakeSurface({ popupSurvivesClick: true });
  await assert.rejects(
    () =>
      dismissBlockingPopups(surface, {
        platformName: "京东",
        popupIdleTimeoutMs: 0,
        popupPollIntervalMs: 1
      }),
    /Timeout 5000ms exceeded/,
    "弹层仍在时必须暴露真实点击失败"
  );
});

test("没有可见弹窗时不点击任何关闭入口", async () => {
  const surface = createFakeSurface();
  surface.popupVisible = false;
  const closedCount = await dismissBlockingPopups(surface, {
    platformName: "京东",
    popupIdleTimeoutMs: 0,
    popupPollIntervalMs: 1
  });
  assert.equal(closedCount, 0);
  assert.equal(surface.clickAttempts, 0);
});

test("弹层反复重建导致连续自行消失：有界停下，不无限循环", async () => {
  const surface = createFakeSurface({ popupSurvivesClick: false });
  // 每次点击后弹层都报告“已消失”，但下一轮扫描又重新检测到遮挡层。
  const originalLocator = surface.locator.bind(surface);
  surface.locator = (selector) => {
    const locator = originalLocator(selector);
    if (String(selector).includes("role='dialog'")) {
      return {
        ...locator,
        async count() {
          return 1;
        }
      };
    }
    return locator;
  };
  await assert.rejects(
    () =>
      dismissBlockingPopups(surface, {
        platformName: "京东",
        popupIdleTimeoutMs: 0,
        popupPollIntervalMs: 1
      }),
    /连续4次确认弹层已消失/,
    "反复重建的遮挡层必须在有界次数内停下"
  );
  assert.equal(surface.clickAttempts, 4, "最多认账 3 次后必须停下");
});
