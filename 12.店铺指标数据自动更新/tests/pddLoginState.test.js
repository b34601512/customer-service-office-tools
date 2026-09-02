const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isPddBusinessUrl,
  isPddLoginUrl,
  detectPddManualVerificationReason,
  isPddMetricPageReady
} = require("../src/platforms/pdd/pddLoginState");

test("拼多多登录和业务地址识别使用脚本会话", () => {
  assert.equal(isPddBusinessUrl("https://mms.pinduoduo.com/sycm/goods_quality/customer"), true);
  assert.equal(isPddLoginUrl("https://mms.pinduoduo.com/login"), true);
  assert.equal(isPddLoginUrl("https://example.com/login"), false);
  assert.equal(detectPddManualVerificationReason("请按住滑块，拖动到最右边", "https://mms.pinduoduo.com/login"), "滑块验证");
});

test("登录成功必须同时满足指标页和店铺身份", async () => {
  const page = {
    url() { return "https://mms.pinduoduo.com/sycm/goods_quality/customer"; },
    locator() {
      return { async innerText() { return "德达旗舰店 客服数据 3分钟人工回复率 97.41%"; } };
    }
  };
  assert.equal(await isPddMetricPageReady(page, { username: "德达旗舰店:小黛" }), true);
  assert.equal(await isPddMetricPageReady(page, { username: "其他店铺:账号" }), false);
});
