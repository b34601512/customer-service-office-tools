const test = require("node:test");
const assert = require("node:assert/strict");
const { JD_EMPTY_VALUE_SOURCE } = require("../src/platforms/jd/storeMetrics/jdMetricText");

// 2026-10-23（霍青桐实测京东1店交易纠纷页）：
// 「工单24小时完结率 --  平台介入率 0.18%」— 旧兜底读法会抓走隔壁的 0.18%。
// 这里锁死判据：标签后面紧跟空值标记 → 视作无数据（返回 null），不许往后找数。
const emptyOf = (trailing) => new RegExp(JD_EMPTY_VALUE_SOURCE).test(trailing);

test("京东指标值为「--」/「—」时判无数据，不读取后面邻居指标的数", () => {
  assert.equal(emptyOf(" -- 平台介入率 0.18% 近7天纠纷商责率 0.00%"), true);
  assert.equal(emptyOf(" — 平台介入率 0.18%"), true);
  assert.equal(emptyOf(" - 平台介入率 0.18%"), true);
  assert.equal(emptyOf(" （空） 0.18%"), false);
});

test("京东指标值正常时照常读取（不误伤）", () => {
  assert.equal(emptyOf(" 100.00% 平台介入率 0.18%"), false);
  assert.equal(emptyOf(" 0.18%"), false);
  assert.equal(emptyOf(" 37.46 小时"), false);
});
