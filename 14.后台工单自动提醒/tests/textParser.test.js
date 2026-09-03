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

// ===== 表格行 → 工单（订单号/纠纷状态）：fixture 来自 jdtest 可申诉页实测 rows-CAN_APPEAL.txt =====
const { parseTicketRows, buildTabUrl } = require("../src/features/workOrderMonitor/textParser");

const REAL_ROW = `84700001
	
退款问题
	
3581494008428198
便利贴
	
×2
DEDAKJ【德国品牌】制氧机配件 过滤器+过滤棉
	
2026-08-27 13:49:10
jd_65a3e7f58350f 
	
商家已和解
	
纠纷单关闭
还剩2天1小时58分
	
去申诉
查看详情`;
const NOISE = ["14151617181920", "C20170418100026", "4006229068" + String.fromCharCode(10) + "联系客服"];

test("实测行解析：订单号+纠纷状态=纠纷单关闭+去申诉标记", () => {
  const tickets = parseTicketRows([REAL_ROW, ...NOISE]);
  assert.strictEqual(tickets.length, 1);
  assert.strictEqual(tickets[0].ticketId, "84700001");
  assert.strictEqual(tickets[0].orderId, "3581494008428198");
  assert.strictEqual(tickets[0].status, "纠纷单关闭");
  assert.strictEqual(tickets[0].canAppeal, true);
});

test("待商家处理行：status 提取供重发判定", () => {
  const row = REAL_ROW.replace("纠纷单关闭", "待商家处理");
  const [tk] = parseTicketRows([row]);
  assert.strictEqual(tk.status, "待商家处理");
});

test("无状态词行：status 空串（不参与重发）", () => {
  const row = REAL_ROW.replace("纠纷单关闭", "");
  const [tk] = parseTicketRows([row]);
  assert.strictEqual(tk.status, "");
});

test("重复行去重、无编号行丢弃", () => {
  const tickets = parseTicketRows([REAL_ROW, REAL_ROW, "普通一段文字没有任何编号"]);
  assert.strictEqual(tickets.length, 1);
});

test("buildTabUrl 替换 tabCode 参数", () => {
  const url = buildTabUrl("https://shop.jd.com/x/list?tabCode=WAIT_EVIDENCE&page=1", "可申诉");
  assert.strictEqual(url, "https://shop.jd.com/x/list?tabCode=CAN_APPEAL&page=1");
  assert.strictEqual(buildTabUrl("https://shop.jd.com/x", "未知页签"), null);
});
