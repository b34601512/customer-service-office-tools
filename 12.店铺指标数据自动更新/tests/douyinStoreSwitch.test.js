const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runAfterDismissingBlockingPopups
} = require("../src/shared/blockingPopupEngine");
const {
  runDouyinMerchantStoreAction,
  findExactDouyinStoreOptionAcrossPages,
  clickDouyinStorePickerOption
} = require("../src/platforms/douyin/douyinStoreIdentity");

class FakePopupElementHandle {
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

class FakeCloseTargetLocator {
  constructor(surface, canClose, closeKind) {
    this.surface = surface;
    this.canClose = canClose;
    this.closeKind = closeKind;
  }

  async count() {
    return this.canClose() ? 1 : 0;
  }

  first() {
    return this;
  }

  async click() {
    assert.equal(this.canClose(), true);
    this.surface.clickedCloseKinds.push(this.closeKind);
    this.surface.advancePopup();
  }
}

class FakePopupInteractiveLocator {
  constructor(surface) {
    this.surface = surface;
  }

  filter(options) {
    return new FakeCloseTargetLocator(
      this.surface,
      () => {
        const popupState = this.surface.currentPopupState();
        return Boolean(popupState?.closeText && options.hasText.test(popupState.closeText));
      },
      "text"
    );
  }
}

class FakePopupLocator {
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
    if (selector === "button:visible, a:visible, [role='button']:visible") {
      return new FakePopupInteractiveLocator(this.surface);
    }
    return new FakeCloseTargetLocator(
      this.surface,
      () => {
        const popupState = this.surface.currentPopupState();
        return Boolean(
          popupState?.hasSemanticClose &&
          (!popupState.requiredSemanticSelector || selector.includes(popupState.requiredSemanticSelector))
        );
      },
      "direct-close"
    );
  }

  async elementHandle() {
    return new FakePopupElementHandle(this.surface);
  }
}

class FakePopupSurface {
  constructor(popupStates) {
    this.popupStates = popupStates;
    this.popupIndex = 0;
    this.clickedCloseKinds = [];
  }

  currentPopupState() {
    return this.popupStates[this.popupIndex] || null;
  }

  advancePopup() {
    this.popupIndex += 1;
  }

  locator() {
    return new FakePopupLocator(this);
  }

  async waitForTimeout() {}
}

test("抖音营销弹窗使用明确关闭控件，不把暂不开启当成关闭", async () => {
  const surface = new FakePopupSurface([
    {
      className: "auxo-modal-wrap merchant-campaign-modal",
      text: "智能客服升级 暂不开启 去配置",
      closeText: "暂不开启",
      hasSemanticClose: false
    }
  ]);

  await assert.rejects(
    () => runAfterDismissingBlockingPopups(surface, async () => "should-not-run", { platformName: "抖音商家首页" }),
    /未找到唯一明确关闭入口/
  );
  assert.deepEqual(surface.clickedCloseKinds, []);
});

test("抖店到货活动弹窗出现时自动点击我知道了再继续操作", async () => {
  const surface = new FakePopupSurface([
    {
      className: "ws-arrival-modal-wrap",
      text: "大促报名0成本 我知道了",
      closeText: "我知道了",
      hasSemanticClose: true,
      requiredSemanticSelector: ".ws-arrival-modal"
    }
  ]);

  const result = await runDouyinMerchantStoreAction(surface, async () => "continued");

  assert.equal(result, "continued");
  assert.deepEqual(surface.clickedCloseKinds, ["text"]);
});

test("抖音切店选项在新页面出现时仍按完整店名自动点击", async () => {
  const expectedIdentity = { storeName: "DEDAKJ医疗器械旗舰店", storeId: "29502951" };
  const originPage = createStoreOptionPage(false, expectedIdentity.storeName);
  const switchPage = createStoreOptionPage(true, expectedIdentity.storeName);
  originPage.context = () => ({ pages: () => [originPage, switchPage] });

  const result = await findExactDouyinStoreOptionAcrossPages(originPage, expectedIdentity, 10);

  assert.equal(result.page, switchPage);
  assert.equal(result.option, switchPage.option);
});

test("抖音正常切店窗口直接点击店铺项，不经过弹窗关闭流程", async () => {
  const clickCalls = [];
  await clickDouyinStorePickerOption({
    async click(options) {
      clickCalls.push(options);
    }
  });
  assert.deepEqual(clickCalls, [{ timeout: 10000 }]);
});

function createStoreOptionPage(hasTarget, storeName) {
  const page = {
    option: {
      async isVisible() {
        return hasTarget;
      },
      async isDisabled() {
        return false;
      }
    },
    getByText(text, options) {
      assert.equal(text, storeName);
      assert.deepEqual(options, { exact: true });
      return {
        async count() {
          return hasTarget ? 1 : 0;
        },
        nth: () => page.option
      };
    },
    async waitForTimeout() {}
  };
  return page;
}
