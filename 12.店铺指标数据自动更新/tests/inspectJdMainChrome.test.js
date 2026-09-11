const test = require("node:test");
const assert = require("node:assert/strict");
const { isJdPage, summarizeDisplayedMetrics, inspectJdMainChrome } = require("../scripts/inspectJdMainChrome");

const shop = "测试旗舰店";
const text = `${shop} 数据日期：2026-09-10 咚咚平均响应时长 12.15 秒 售后服务时长 29.793 小时 店铺评价得分 9.6 分`;

function createConnection(pageText = text, titles = ["星级概览"]) {
  const calls = [];
  const url = "https://shop.jd.com/";
  const pages = titles.map((title) => ({
    url: () => url,
    title: async () => title,
    frames: () => [{ url: () => url, locator: (selector) => {
      assert.equal(selector, "body");
      return { innerText: async () => pageText };
    } }]
  }));
  const browserType = { connectOverCDP: async (...args) => {
    calls.push(args);
    return {
      version: () => "144.0.0.0",
      contexts: () => [{ pages: () => pages }],
      close: async () => calls.push("disconnect")
    };
  } };
  return { browserType, calls };
}

test("只接受京东HTTPS地址，不接受相似域名", () => {
  assert.equal(isJdPage("https://shop.jd.com/"), true);
  for (const url of ["https://jd.com.example.com/", "https://fakejd.com/", "http://shop.jd.com/", "about:blank"]) {
    assert.equal(isJdPage(url), false);
  }
});

test("读取显示值和真实日期，真实0与未读到严格区分", () => {
  const report = summarizeDisplayedMetrics(text.replace("12.15", "0"), shop);
  assert.equal(report.status, "snapshot-read");
  assert.equal(report.dataDate, "2026-09-10");
  assert.deepEqual(report.metrics.map((metric) => metric.displayedValue), [0, 29.793, 9.6]);
  const empty = summarizeDisplayedMetrics(`${shop} 咚咚平均响应时长 —`, shop);
  assert.equal(empty.status, "needs-inspection");
  assert.equal(empty.dataDate, null);
  assert.equal(empty.metrics[0].displayedValue, null);
});

test("拒绝把其他店数据归入目标店", () => {
  assert.throws(() => summarizeDisplayedMetrics(text, "另一家旗舰店"), /未显示指定店名/);
});

test("使用现有Chrome连接，读取后仅断开，不需要启动、导航、刷新或写表能力", async () => {
  const { browserType, calls } = createConnection();
  const report = await inspectJdMainChrome(shop, browserType);
  assert.equal(report.status, "snapshot-read");
  assert.deepEqual(calls, [["chrome", { timeout: 30000, noDefaults: true }], "disconnect"]);
});

test("店铺不匹配或候选页有歧义时停止并断开", async () => {
  for (const connection of [createConnection("其他店"), createConnection(text, ["星级概览", "星级概览"])]) {
    await assert.rejects(inspectJdMainChrome(shop, connection.browserType), /未显示指定店名|找到2个/);
    assert.equal(connection.calls.at(-1), "disconnect");
  }
});

test("连接失败只尝试一次，不回退独立浏览器", async () => {
  let calls = 0;
  const browserType = { connectOverCDP: async () => { calls += 1; throw new Error("连接未启用"); } };
  await assert.rejects(inspectJdMainChrome(shop, browserType), /连接未启用/);
  assert.equal(calls, 1);
});
