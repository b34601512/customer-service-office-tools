// 配置校验测试：确保缺字段时报中文可行动错误。
const test = require("node:test");
const assert = require("node:assert");
const { validateConfig } = require("../src/config/projectConfigService");

const base = () => JSON.parse(JSON.stringify({
  wecom: { webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc" },
  monitor: { intervalMinutes: 5, loginAlertThrottleMinutes: 60 },
  platforms: {
    jd: {
      displayName: "京东",
      stores: [{
        key: "jingxi1", displayName: "京喜1店", username: "u",
        sources: [{ key: "wo", type: "jingxiWorkOrder", url: "https://sale-jdm.jd.com/workOrder/workOrderList", watch: ["待处理"] }]
      }]
    }
  }
}));

test("合法配置通过", () => {
  assert.doesNotThrow(() => validateConfig(base()));
});

test("缺店铺账号报错", () => {
  const c = base();
  c.platforms.jd.stores[0].username = "";
  assert.throws(() => validateConfig(c), /username/);
});

test("不支持的提醒源类型报错", () => {
  const c = base();
  c.platforms.jd.stores[0].sources[0].type = "tmall";
  assert.throws(() => validateConfig(c), /不支持/);
});

test("企微地址错误报错", () => {
  const c = base();
  c.wecom.webhookUrl = "http://evil.example/";
  assert.throws(() => validateConfig(c), /webhookUrl 格式不正确/);
});

test("没有任何店铺报错", () => {
  const c = base();
  c.platforms.jd.stores = [];
  assert.throws(() => validateConfig(c), /至少需要一个店铺/);
});
