const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runAfterDismissingJdPopups
} = require("../src/platforms/jd/jdPopupAndSurfaceState");

class FakeJdPopupElementHandle {
  constructor(surface) {
    this.surface = surface;
  }

  async evaluate() {
    const popupState = this.surface.currentPopupState();
    if (!popupState) throw new Error("popup detached");
    return {
      className: popupState.className,
      text: popupState.text,
      visible: true
    };
  }

  async dispose() {}
}

class FakeJdCloseTargetLocator {
  constructor(surface, selector) {
    this.surface = surface;
    this.selector = selector;
  }

  async count() {
    return this.surface.currentPopupState() && this.selector.includes(".close-modal") ? 1 : 0;
  }

  first() {
    return this;
  }

  async click() {
    assert.equal(this.surface.currentPopupState() !== null, true);
    this.surface.clickedSelectors.push(this.selector);
    this.surface.closePopup();
  }
}

class FakeJdPopupLocator {
  constructor(surface) {
    this.surface = surface;
  }

  async count() {
    return this.surface.currentPopupState() ? 1 : 0;
  }

  first() {
    return this;
  }

  locator(selector) {
    return new FakeJdCloseTargetLocator(this.surface, selector);
  }

  async elementHandle() {
    return new FakeJdPopupElementHandle(this.surface);
  }
}

class FakeJdPopupSurface {
  constructor({ popupState, manualVerificationText = "" }) {
    this.popupState = popupState;
    this.manualVerificationText = manualVerificationText;
    this.clickedSelectors = [];
  }

  currentPopupState() {
    return this.popupState;
  }

  closePopup() {
    this.popupState = null;
  }

  locator() {
    return new FakeJdPopupLocator(this);
  }

  frames() {
    return [];
  }

  async evaluate() {
    return this.manualVerificationText;
  }

  async waitForTimeout() {}
}

test("京东商智营销弹窗只点击唯一关闭控件并继续动作", async () => {
  const surface = new FakeJdPopupSurface({
    popupState: {
      className: "jmt-dialog-portal win-notice-modal",
      text: "商智AI搜索推广",
    }
  });
  let actionCount = 0;

  const result = await runAfterDismissingJdPopups(surface, async () => {
    actionCount += 1;
    return "continued";
  });

  assert.equal(result, "continued");
  assert.equal(actionCount, 1);
  assert.equal(surface.clickedSelectors.length, 1);
  assert.match(surface.clickedSelectors[0], /\.close-modal/);
  assert.equal(surface.currentPopupState(), null);
});

test("京东安全验证页面不自动关闭弹窗", async () => {
  const surface = new FakeJdPopupSurface({
    popupState: {
      className: "jmt-dialog-portal win-notice-modal",
      text: "安全验证",
    },
    manualVerificationText: "滑块验证"
  });

  await runAfterDismissingJdPopups(surface, async () => "waiting");

  assert.deepEqual(surface.clickedSelectors, []);
  assert.notEqual(surface.currentPopupState(), null);
});
