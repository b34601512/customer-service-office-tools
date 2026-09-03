// 解析层测试：使用 #623 实测采集到的真实页面文本片段作为 fixture。
const test = require("node:test");
const assert = require("node:assert");
const { parseCounts, isLoginRedirect, looksLikeBrokenPage } = require("../src/features/workOrderMonitor/textParser");

const JINGXI_TEXT = "任务工单\n帮助文档\n待处理(0)全部\n平台协同工单 (0)物流投诉工单 (0)安装求助工单 (0)催开发票工单 (0)\n订单编号";
const POP_TEXT = "交易纠纷管理\n帮助文档\n全部(1313)\n京东介入(0)\n待回复(0)\n待处理(0)\n和解中(0)\n待执行(0)\n可申诉(1)\n已申诉(13)\n订单编号";

test("京喜工单页：解析全部分类计数", () => {
  const counts = parseCounts(JINGXI_TEXT, ["待处理", "平台协同工单", "物流投诉工单", "安装求助工单", "催开发票工单"]);
  assert.deepStrictEqual(counts, { "待处理": 0, "平台协同工单": 0, "物流投诉工单": 0, "安装求助工单": 0, "催开发票工单": 0 });
});

test("京喜工单页：非零计数与全角括号也能解析", () => {
  const text = "待处理（3）\n平台协同工单 (3)物流投诉工单 (10)安装求助工单 (0)催开发票工单 (1)";
  const counts = parseCounts(text, ["待处理", "平台协同工单", "物流投诉工单", "催开发票工单"]);
  assert.strictEqual(counts["待处理"], 3);
  assert.strictEqual(counts["物流投诉工单"], 10);
  assert.strictEqual(counts["催开发票工单"], 1);
});

test("POP纠纷页：解析页签计数且不误配前缀", () => {
  const counts = parseCounts(POP_TEXT, ["待回复", "待处理", "京东介入", "待执行", "可申诉", "已申诉"]);
  assert.deepStrictEqual(counts, { "待回复": 0, "待处理": 0, "京东介入": 0, "待执行": 0, "可申诉": 1, "已申诉": 13 });
});

test("登录跳转识别", () => {
  assert.strictEqual(isLoginRedirect("https://passport.shop.jd.com/login/index.action/jdm?ReturnUrl=x"), true);
  assert.strictEqual(isLoginRedirect("https://sale-jdm.jd.com/workOrder/workOrderList"), false);
});

test("空白页识别为异常", () => {
  assert.strictEqual(looksLikeBrokenPage("", ["待处理"]), true);
  assert.strictEqual(looksLikeBrokenPage(JINGXI_TEXT, ["待处理"]), false);
});
