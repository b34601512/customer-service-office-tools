const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ensureDouyinMerchantSession
} = require("../src/platforms/douyin/douyinLoginRecovery");
const { DOUYIN_SHOP_HEADER_SELECTOR } = require("../src/platforms/douyin/douyinSelectors");

test("抖音已有任一登录店铺页面时复用会话，不重新导航登录页", async () => {
  let gotoCount = 0;
  const page = {
    url() {
      return "https://fxg.jinritemai.com/ffa/eco/experience-score";
    },
    locator(selector) {
      if (selector === DOUYIN_SHOP_HEADER_SELECTOR) {
        return {
          first() {
            return {
              async count() {
                return 1;
              },
              async isVisible() {
                return true;
              }
            };
          }
        };
      }
      if (selector === "body") {
        return { innerText: async () => "当前已登录店铺" };
      }
      throw new Error(`unexpected locator: ${selector}`);
    },
    async goto() {
      gotoCount += 1;
    }
  };
  const browser = {
    contexts() {
      return [{ pages: () => [page] }];
    }
  };
  const progress = [];

  const result = await ensureDouyinMerchantSession(
    browser,
    page,
    (stage, detail) => progress.push({ stage, detail })
  );

  assert.equal(result, page);
  assert.equal(gotoCount, 0);
  assert.deepEqual(progress, [{
    stage: "复用抖音登录会话",
    detail: "已检测到当前登录店铺，后续将校验并切换目标店铺"
  }]);
});

test("抖音改版：店铺名元素是 CSS Modules 哈希类名时也能识别已登录", async () => {
  const { DOUYIN_SHOP_HEADER_SELECTOR: SEL } = require("../src/platforms/douyin/douyinSelectors");
  const page = {
    url() {
      return "https://fxg.jinritemai.com/ffa/mshop/homepage/index";
    },
    locator(selector) {
      if (selector === SEL) {
        // 关键断言：选择器必须同时兼容旧裸类名与新版哈希类名
        assert.ok(String(selector).includes(".headerShopName"));
        assert.ok(String(selector).includes("[class*='headerShopName']"));
        return {
          first() {
            return {
              async count() {
                return 1;
              },
              async isVisible() {
                return true;
              }
            };
          }
        };
      }
      if (selector === "body") {
        return { innerText: async () => "德达医疗康养器械旗舰店 旗舰店 正常营业" };
      }
      throw new Error(`unexpected locator: ${selector}`);
    },
    async goto() {}
  };
  const browser = { contexts() { return [{ pages: () => [page] }]; } };
  const result = await ensureDouyinMerchantSession(browser, page, () => {});
  assert.equal(result, page);
});
