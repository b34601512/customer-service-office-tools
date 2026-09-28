// 读拼多多「发票中心」里某一单的信息（平台应开金额、票种、抬头、税号）。
// 纯解析函数可单测；浏览器读取函数复用 5号 的登录态与页面能力（只读，不点任何提交）。
const path = require("path");

const 发票中心地址 = "https://mms.pinduoduo.com/invoice/center?quickFilterValue=";
const 五号目录 = path.resolve(__dirname, "../../5.拼多多发票回传");

/**
 * 从发票中心页面正文里解析指定订单行（纯函数）。
 * 页面行样式（实测）：订单号单独一行，下一行制表符分隔：
 *   已收货  正常  2026-09-28 14:30:26  ¥374.12  手动  电票  蓝票  企业  抬头  税号  -  -  承诺时间
 * @param {string} 正文
 * @param {string} 订单号
 */
function 解析发票中心订单行(正文, 订单号) {
  const 文本 = String(正文 || "");
  const 位置 = 文本.indexOf(订单号);
  if (位置 < 0) return null;
  const 之后 = 文本.slice(位置 + 订单号.length);
  const 行列表 = 之后.split("\n").map((行) => 行.replace(/\u00a0/g, " ").trim()).filter((行) => 行 !== "");
  const 数据行 = 行列表.find((行) => 行.includes("¥") || 行.includes("￥"));
  if (!数据行) return null;
  const 字段 = 数据行.split(/\t+/).map((f) => f.trim()).filter((f) => f !== "");
  const 金额字段 = 字段.find((f) => /[¥￥]/.test(f)) || "";
  const 金额 = Number(金额字段.replace(/[¥￥,\s]/g, ""));
  const 税号 = 字段.find((f) => /^[0-9A-Z]{15,20}$/i.test(f)) || "";
  const 抬头 = 税号 ? 字段[字段.indexOf(税号) - 1] || "" : "";
  const 时间列表 = 数据行.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) || [];
  return {
    订单号,
    金额: Number.isFinite(金额) ? 金额 : null,
    税号,
    抬头,
    申请时间: 时间列表[0] || "",
    承诺时间: 时间列表[时间列表.length - 1] || "",
    票种: 字段.includes("电票") ? "电票" : 字段.includes("纸票") ? "纸票" : "",
    发票颜色: 字段.includes("蓝票") ? "蓝票" : 字段.includes("红票") ? "红票" : "",
    抬头类型: 字段.includes("企业") ? "企业" : 字段.includes("个人") ? "个人" : "",
    原始字段: 字段
  };
}

/** 打开店铺发票中心并按订单号搜索（只读）。 */
async function 读取拼多多发票中心订单({ 店铺Id, 订单号, headless = false }) {
  const { 读取店铺配置 } = require(path.join(五号目录, "src/store/storeConfigService"));
  const { 创建拼多多店铺浏览器上下文 } = require(path.join(五号目录, "src/browser/pddBrowserContext"));
  const { 打开拼多多待回传发票页面 } = require(path.join(五号目录, "src/invoiceReturn/pddInvoicePage"));
  const 店铺 = (读取店铺配置().stores || []).find((s) => s.id === 店铺Id);
  if (!店铺) throw new Error("5号 店铺配置里找不到：" + 店铺Id);
  const 上下文 = await 创建拼多多店铺浏览器上下文(店铺, { headless });
  try {
    const 页面 = 上下文.pages().find((p) => !p.isClosed()) || (await 上下文.newPage());
    await 打开拼多多待回传发票页面(页面, 店铺);
    const 搜索框 = 页面.locator('input[placeholder="请输入订单编号"]').first();
    if (!(await 搜索框.count())) throw new Error("发票中心页面上找不到「请输入订单编号」搜索框");
    await 搜索框.fill(订单号);
    await 搜索框.press("Enter");
    await 页面.waitForTimeout(6000);
    const 正文 = await 页面.locator("body").innerText({ timeout: 15000 });
    return { 页面地址: 页面.url(), 解析结果: 解析发票中心订单行(正文, 订单号), 正文 };
  } finally {
    await 上下文.close();
  }
}

module.exports = { 发票中心地址, 解析发票中心订单行, 读取拼多多发票中心订单 };
