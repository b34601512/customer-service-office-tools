const assert = require("assert");
const {
  dismissBlockingPopups,
  runAfterDismissingBlockingPopups
} = require("../src/shared/blockingPopupEngine");
const {
  buildDouyinDateCellSelector
} = require("../src/platforms/douyin/downloadTaskParts/douyinDateApplier");
const {
  readDouyinStoreName,
  readCurrentDouyinStoreName,
  readDouyinStoreIdFromOpenMenu,
  waitForDouyinStoreIdInOpenMenu
} = require("../src/platforms/douyin/downloadTaskParts/douyinStoreIdentity");
const {
  runDouyinMerchantStoreAction,
  clickDouyinSwitchStoreEntry
} = require("../src/platforms/douyin/downloadTaskParts/douyinStoreMenu");
const {
  ensureDouyinStoreMenuAndCollectCurrentIdentity,
  ensureDouyinActiveStore
} = require("../src/platforms/douyin/downloadTaskParts/douyinStoreSwitcher");

class FakePopupElementHandle {
  constructor(surface) {
    this.surface = surface;
  }

  async evaluate() {
    const popupState = this.surface.currentPopupState();
    if (!popupState) {
      throw new Error("popup detached");
    }
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
    assert.strictEqual(this.canClose(), true);
    this.surface.clickedCloseKinds.push(this.closeKind);
    this.surface.advancePopup();
  }
}

class FakePopupInteractiveLocator {
  constructor(surface) {
    this.surface = surface;
  }

  filter(options) {
    return new FakeCloseTargetLocator(this.surface, () => {
      const popupState = this.surface.currentPopupState();
      return Boolean(popupState?.closeText && options.hasText.test(popupState.closeText));
    }, "text");
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
  constructor(popupStates = []) {
    this.popupStates = popupStates;
    this.popupIndex = 0;
    this.lastPopupSelector = "";
    this.clickedCloseKinds = [];
  }

  currentPopupState() {
    return this.popupStates[this.popupIndex] || null;
  }

  advancePopup() {
    this.popupIndex += 1;
  }

  showPopups(popupStates) {
    this.popupStates = popupStates;
    this.popupIndex = 0;
  }

  locator(selector) {
    this.lastPopupSelector = selector;
    return new FakePopupLocator(this);
  }

  async waitForTimeout() {}
}

function createCollectedPopupStates() {
  return [
    {
      className: "auxo-tooltip-inner",
      text: "客服表现 原客服绩效内容已经合并 知道了",
      closeText: "知道了"
    },
    {
      className: "auxo-tooltip-inner",
      text: "日期筛选 历史数据可通过日期筛选进行查看 知道了",
      closeText: "知道了"
    },
    {
      className: "auxo-tooltip-inner",
      text: "数据指标精细化 数据新增字段 知道了",
      closeText: "知道了"
    },
    {
      className: "auxo-modal-wrap auxo-modal-centered",
      text: "智能客服升级 开启评价奖励自动回复 暂不开启 去配置",
      closeText: "暂不开启",
      hasSemanticClose: true,
      requiredSemanticSelector: ".auxo-modal-close"
    }
  ];
}

async function testCollectedPopupChainClosesSafely() {
  const surface = new FakePopupSurface(createCollectedPopupStates());
  const closedPopupCount = await dismissBlockingPopups(surface, { platformName: "抖音" });
  assert.strictEqual(closedPopupCount, 4);
  assert.strictEqual(surface.currentPopupState(), null);
  assert.strictEqual(surface.clickedCloseKinds.at(-1), "direct-close");
  assert.match(
    surface.lastPopupSelector,
    /\[role='tooltip'\]\.auxo-tooltip-inner:has\(\.auxo-dorami-guide-single-content-wrapper\)/
  );
}

async function testTemporaryDisableTextIsNotClicked() {
  const surface = new FakePopupSurface([
    {
      className: "auxo-modal-wrap",
      text: "智能客服升级 暂不开启 去配置",
      closeText: "暂不开启"
    }
  ]);
  await assert.rejects(
    () => dismissBlockingPopups(surface, { platformName: "抖音" }),
    /未找到唯一明确关闭入口/
  );
  assert.deepStrictEqual(surface.clickedCloseKinds, []);
  assert.strictEqual(surface.popupIndex, 0);
}

async function testDouyinMerchantStoreActionClosesMarketingPopupBeforeClicking() {
  const surface = new FakePopupSurface([
    {
      className: "auxo-modal-wrap merchant-campaign-modal",
      text: "限时专属邀请函 推荐高质量高爆发品 报名大促 立即报名抢流量",
      hasSemanticClose: true,
      requiredSemanticSelector: ".auxo-modal-close"
    }
  ]);
  let storeActionCount = 0;
  const result = await runDouyinMerchantStoreAction(surface, async () => {
    storeActionCount += 1;
    return "store-action-completed";
  });
  assert.strictEqual(result, "store-action-completed");
  assert.strictEqual(storeActionCount, 1);
  assert.deepStrictEqual(surface.clickedCloseKinds, ["direct-close"]);
  assert.strictEqual(surface.currentPopupState(), null);
}

async function testDouyinEmptyModalUsesExplicitCloseIcon() {
  const surface = new FakePopupSurface([
    {
      className: "auxo-modal-wrap auxo-modal-centered",
      text: "",
      hasSemanticClose: true,
      requiredSemanticSelector: "other_close__"
    }
  ]);
  const closedPopupCount = await dismissBlockingPopups(surface, { platformName: "抖音" });
  assert.strictEqual(closedPopupCount, 1);
  assert.deepStrictEqual(surface.clickedCloseKinds, ["direct-close"]);
  assert.strictEqual(surface.currentPopupState(), null);
}

async function testDouyinMerchantStoreActionRecoversLateMarketingPopup() {
  const surface = new FakePopupSurface();
  let storeActionCount = 0;
  const result = await runDouyinMerchantStoreAction(surface, async () => {
    storeActionCount += 1;
    if (storeActionCount === 1) {
      surface.showPopups([
        {
          className: "auxo-modal-wrap merchant-campaign-modal",
          text: "限时专属邀请函 立即报名抢流量",
          hasSemanticClose: true,
          requiredSemanticSelector: ".auxo-modal-close"
        }
      ]);
      throw new Error("merchant popup intercepted store action");
    }
    return "store-action-recovered";
  });
  assert.strictEqual(result, "store-action-recovered");
  assert.strictEqual(storeActionCount, 2);
  assert.deepStrictEqual(surface.clickedCloseKinds, ["direct-close"]);
}

async function testUnknownBusinessPopupStopsWithoutClicking() {
  const surface = new FakePopupSurface([
    {
      className: "auxo-modal-wrap",
      text: "未知业务弹窗 开启试试",
      closeText: "开启试试"
    }
  ]);
  await assert.rejects(
    () => dismissBlockingPopups(surface, { platformName: "抖音" }),
    /未找到唯一明确关闭入口/
  );
  assert.strictEqual(surface.popupIndex, 0);
}

async function testLatePopupRecoversOneAction() {
  const surface = new FakePopupSurface();
  let actionAttempts = 0;
  const actionResult = await runAfterDismissingBlockingPopups(
    surface,
    async () => {
      actionAttempts += 1;
      if (actionAttempts === 1) {
        surface.showPopups([
          {
            className: "auxo-modal-wrap",
            text: "异步晚到弹窗",
            hasSemanticClose: true
          }
        ]);
        throw new Error("blocked by popup");
      }
      return "ok";
    },
    { platformName: "抖音" }
  );
  assert.strictEqual(actionResult, "ok");
  assert.strictEqual(actionAttempts, 2);
  assert.strictEqual(surface.currentPopupState(), null);
}

function testDouyinDateSelectorExcludesAdjacentMonthCells() {
  const selector = buildDouyinDateCellSelector("2026-07-27");
  assert.strictEqual(
    selector,
    '.ecom-picker-dropdown td.ecom-picker-cell-in-view[title="2026-07-27"]:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner'
  );
}

async function testDouyinStoreNameIgnoresExpandedPopoverText() {
  const pureStoreNameLocator = {
    async count() {
      return 1;
    },
    nth() {
      return this;
    },
    async isVisible() {
      return true;
    },
    async innerText() {
      return "DEDAKJ医疗器械旗舰店";
    }
  };
  const expandedShopHeader = {
    locator(selector) {
      assert.strictEqual(selector, ':scope > [data-bytereplay-mask="true"]');
      return pureStoreNameLocator;
    },
    async innerText() {
      return "DEDAKJ医疗器械旗舰店 旗舰店 正常营业 店铺信息 店铺ID 29502951 切换组织/店铺 退出";
    }
  };
  assert.strictEqual(
    await readDouyinStoreName(expandedShopHeader),
    "DEDAKJ医疗器械旗舰店"
  );
}

async function testDouyinStoreNameReadDoesNotOpenMenu() {
  const page = new FakeDouyinStorePage({
    storeName: "DEDAKJ医疗器械旗舰店",
    storeId: "29502951"
  });
  const storeName = await readCurrentDouyinStoreName(page);
  assert.strictEqual(storeName, "DEDAKJ医疗器械旗舰店");
  assert.strictEqual(page.headerClickCount, 0);
}

class FakeDouyinStorePage {
  constructor(options = {}) {
    this.storeName = options.storeName;
    this.storeId = options.storeId;
    this.storeIdText = options.storeIdText || `店铺ID ${options.storeId}`;
    this.storeIdVisibleAfterBodyReadCount = options.storeIdVisibleAfterBodyReadCount || 0;
    this.menuOpen = false;
    this.closeMenuAfterIdentityRead = Boolean(options.closeMenuAfterIdentityRead);
    this.headerClickCount = 0;
    this.switchEntryClickCount = 0;
    this.bodyReadCount = 0;
    this.storeNameLocator = {
      count: async () => 1,
      nth() {
        return this;
      },
      isVisible: async () => true,
      innerText: async () => options.storeName
    };
    this.shopHeader = {
      locator: (selector) => {
        assert.strictEqual(selector, ':scope > [data-bytereplay-mask="true"]');
        return this.storeNameLocator;
      },
      waitFor: async () => {},
      click: async () => {
        this.headerClickCount += 1;
        this.menuOpen = true;
      }
    };
    this.switchEntry = {
      isVisible: async () => this.menuOpen,
      click: async () => {
        assert.strictEqual(this.menuOpen, true);
        this.switchEntryClickCount += 1;
        this.menuOpen = false;
      }
    };
  }

  locator(selector) {
    if (selector === ".headerShopName") {
      return { first: () => this.shopHeader };
    }
    if (selector === "body") {
      return {
        innerText: async () => {
          this.bodyReadCount += 1;
          const shouldShowStoreId = !this.storeIdVisibleAfterBodyReadCount ||
            this.bodyReadCount >= this.storeIdVisibleAfterBodyReadCount;
          const bodyText = this.menuOpen
            ? `${shouldShowStoreId ? this.storeIdText : "店铺信息加载中"} 切换组织/店铺`
            : "抖店首页";
          if (this.closeMenuAfterIdentityRead) {
            this.menuOpen = false;
          }
          return bodyText;
        }
      };
    }
    if (selector.includes("[role='dialog']")) {
      return {
        count: async () => 0,
        first() {
          return this;
        }
      };
    }
    throw new Error(`unexpected locator: ${selector}`);
  }

  getByText(text, options) {
    assert.strictEqual(text, "切换组织/店铺");
    assert.deepStrictEqual(options, { exact: true });
    return {
      count: async () => 1,
      nth: () => this.switchEntry
    };
  }

  async waitForTimeout() {}
}

async function testDouyinStoreIdReaderAcceptsRealMenuSpacing() {
  const page = new FakeDouyinStorePage({
    storeName: "DEDAKJ医疗器械旗舰店",
    storeId: "29502951",
    storeIdText: "店铺 ID：\n29502951"
  });
  page.menuOpen = true;
  assert.strictEqual(await readDouyinStoreIdFromOpenMenu(page), "29502951");
}

async function testDouyinStoreIdReaderWaitsForMenuIdentityToRender() {
  const page = new FakeDouyinStorePage({
    storeName: "DEDAKJ医疗器械旗舰店",
    storeId: "29502951",
    storeIdVisibleAfterBodyReadCount: 3
  });
  page.menuOpen = true;
  assert.strictEqual(await waitForDouyinStoreIdInOpenMenu(page, 5000), "29502951");
  assert.strictEqual(page.bodyReadCount, 3);
}

async function testMatchedDouyinStoreDoesNotSwitch() {
  const page = new FakeDouyinStorePage({
    storeName: "DEDAKJ医疗器械旗舰店",
    storeId: "29502951"
  });
  const result = await ensureDouyinActiveStore(page, {
    displayName: "dedakj抖音",
    platformStoreName: "DEDAKJ医疗器械旗舰店",
    platformStoreId: "29502951"
  }, () => {});
  assert.deepStrictEqual(result.identity, {
    storeName: "DEDAKJ医疗器械旗舰店",
    storeId: "29502951"
  });
  assert.strictEqual(page.headerClickCount, 1);
  assert.strictEqual(page.switchEntryClickCount, 0);
}

async function testClosedDouyinStoreMenuIsReopenedBeforeSwitching() {
  const page = new FakeDouyinStorePage({
    storeName: "DEDAKJ医疗器械旗舰店",
    storeId: "29502951",
    closeMenuAfterIdentityRead: true
  });
  await ensureDouyinStoreMenuAndCollectCurrentIdentity(page);
  assert.strictEqual(page.menuOpen, false);
  await clickDouyinSwitchStoreEntry(page);
  assert.strictEqual(page.headerClickCount, 2);
  assert.strictEqual(page.switchEntryClickCount, 1);
}

async function run() {
  await testCollectedPopupChainClosesSafely();
  console.log("PASS 抖音三步引导和智能客服弹窗应优先点击直接关闭控件");
  await testTemporaryDisableTextIsNotClicked();
  console.log("PASS 抖音只有暂不开启时应停止且不点击业务选项");
  await testDouyinMerchantStoreActionClosesMarketingPopupBeforeClicking();
  console.log("PASS 抖音商家首页切店动作前应关闭明确营销弹窗");
  await testDouyinEmptyModalUsesExplicitCloseIcon();
  console.log("PASS 抖音空内容弹窗应点击明确关闭图标");
  await testDouyinMerchantStoreActionRecoversLateMarketingPopup();
  console.log("PASS 抖音商家首页营销弹窗异步抢先时应关闭后只重试一次切店动作");
  await testUnknownBusinessPopupStopsWithoutClicking();
  console.log("PASS 未知业务弹窗没有明确关闭入口时应停止且不点击");
  await testLatePopupRecoversOneAction();
  console.log("PASS 异步晚到弹窗关闭后应只重试一次原动作");
  testDouyinDateSelectorExcludesAdjacentMonthCells();
  console.log("PASS 抖音日期规则应排除相邻月份同 title 补位格");
  await testDouyinStoreNameIgnoresExpandedPopoverText();
  console.log("PASS 抖音切店弹层展开时应只读取顶部纯店名节点");
  await testDouyinStoreNameReadDoesNotOpenMenu();
  console.log("PASS 抖音店铺名称读取不应自动打开店铺菜单");
  await testDouyinStoreIdReaderAcceptsRealMenuSpacing();
  console.log("PASS 抖音店铺 ID 读取兼容空格、换行和冒号排版");
  await testDouyinStoreIdReaderWaitsForMenuIdentityToRender();
  console.log("PASS 抖音店铺 ID 读取会等待菜单身份文本完成渲染");
  await testMatchedDouyinStoreDoesNotSwitch();
  console.log("PASS 抖音当前店铺已匹配时不应触发切店");
  await testClosedDouyinStoreMenuIsReopenedBeforeSwitching();
  console.log("PASS 抖音切店前菜单已收起时应重新展开再点击入口");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
