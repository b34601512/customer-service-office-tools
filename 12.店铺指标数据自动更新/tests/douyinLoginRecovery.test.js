const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ensureDouyinMerchantSession
} = require("../src/platforms/douyin/douyinLoginRecovery");

test("抖音已有任一登录店铺页面时复用会话，不重新导航登录页", async () => {
  let gotoCount = 0;
  const page = {
    url() {
      return "https://fxg.jinritemai.com/ffa/eco/experience-score";
    },
    locator(selector) {
      if (selector === ".headerShopName") {
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
