// 该文件回归 2026-09-03 天猫月初单日日期问题：
// 智能模式在每月 3 号会产出“1号~1号”单日区间，天猫页面把单日折叠显示为“统计时间YYYY-MM-DD”，
// 验收规则必须支持单日等价，同时保持多日区间仍严格成对匹配。
const assert = require("assert");
const {
  isTmallDateRangeMatched,
  extractDateTexts,
  describeTmallDateText,
  buildExpectedDateText
} = require("../src/platforms/tmall/dateApplierParts/tmallDateText");
const {
  waitForTmallPageDateApplied
} = require("../src/platforms/tmall/dateApplierParts/tmallDatePageVerification");

function makeTmallPageWithDateText(dateText) {
  return {
    locator() {
      return {
        first() {
          return {
            async isVisible() {
              return true;
            },
            async innerText() {
              return dateText;
            }
          };
        }
      };
    },
    async waitForTimeout() {}
  };
}

const singleDay = { startText: "2026-09-01", endText: "2026-09-01" };
const monthRange = { startText: "2026-08-01", endText: "2026-08-31" };

// 单日区间：折叠显示、成对显示、带前缀显示都必须命中。
assert.strictEqual(isTmallDateRangeMatched("统计时间2026-09-01", singleDay), true);
assert.strictEqual(isTmallDateRangeMatched("2026-09-01~2026-09-01", singleDay), true);
assert.strictEqual(isTmallDateRangeMatched("已选择：2026-09-01", singleDay), true);
// 单日区间：页面显示其他单日或任何多日窗口都必须判失败，防止筛选未生效被放过。
assert.strictEqual(isTmallDateRangeMatched("统计时间2026-08-31", singleDay), false);
assert.strictEqual(isTmallDateRangeMatched("2026-08-26~2026-09-01", singleDay), false);
assert.strictEqual(isTmallDateRangeMatched("2026-09-01", { startText: "", endText: "" }), false);
// 多日区间：必须严格成对命中，单日显示不能通过。
assert.strictEqual(isTmallDateRangeMatched("2026-08-01~2026-08-31", monthRange), true);
assert.strictEqual(isTmallDateRangeMatched("已选择：2026-08-01 至 2026-08-31", monthRange), true);
assert.strictEqual(isTmallDateRangeMatched("统计时间2026-08-31", monthRange), false);
assert.strictEqual(isTmallDateRangeMatched("2026-08-01~2026-08-30", monthRange), false);

assert.deepStrictEqual(extractDateTexts("统计时间 2026-09-01"), ["2026-09-01"]);
// 生产现场字符串（2026-09-03 16:32 失败日志原文）：稳定判定器读到的 "统计时间 2026-09-01" 必须命中单日。
assert.strictEqual(isTmallDateRangeMatched("统计时间 2026-09-01", singleDay), true);
assert.strictEqual(describeTmallDateText("统计时间2026-09-01"), "2026-09-01");
assert.strictEqual(buildExpectedDateText(singleDay), "2026-09-01~2026-09-01");

(async () => {
  const appliedText = await waitForTmallPageDateApplied(makeTmallPageWithDateText("统计时间2026-09-01"), singleDay);
  assert.strictEqual(appliedText, "统计时间2026-09-01");
  console.log("tmallSingleDayDate.test.js: all assertions passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
