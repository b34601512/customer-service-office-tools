const test = require("node:test");
const assert = require("node:assert/strict");
const { isPddMetricContentReady } = require("../src/platforms/pdd/storeMetrics/pddPageNavigator");

test("拼多多页面等待真实指标卡片，避免只看到导航文字就提前读取", () => {
  assert.equal(
    isPddMetricContentReady("afterSales", "售后数据 TOP退款商品 纠纷退款数 纠纷退款率 暂无数据"),
    false
  );
  assert.equal(
    isPddMetricContentReady("afterSales", "售后数据 整体情况（统计时间：2026-08-01）纠纷退款数 4 纠纷退款率 0.22%"),
    true
  );
  assert.equal(
    isPddMetricContentReady("overall", "综合体验星级 店铺综合体验星级 5 星 拼多多App显示5.0星 已超越80%同行"),
    true
  );
});
