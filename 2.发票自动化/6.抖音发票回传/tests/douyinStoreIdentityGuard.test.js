// 2026-09-20 issues/009：回传阶段反复报「读取抖音当前店铺 ID 失败：顶部店铺信息识别到 0 个有效店铺 ID」，
// 而截屏显示页面正常、店铺面板里明摆着店铺ID。修前先留现场（成功/失败各一份 DOM），并锁死：
// ①面板已渲染出店铺ID 时必须读得到；②轮询读身份必须能用短超时；③等待目标店铺内层逐页循环必须有截止时间。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { 读取当前抖音店铺身份, 等待目标店铺 } = require("../src/browser/douyinStoreIdentity");

function 造头部(店名 = "德达医疗康养器械旗舰店", 店铺ID = "162329841") {
  const 头部 = {
    waitFor: async () => {},
    evaluate: async () => ({ 可见: true }),
    locator: (选择器) => ({
      count: async () => 1,
      nth: () => ({
        isVisible: async () => true,
        innerText: async () => 店名,
        getAttribute: async () => (String(选择器).includes('label="店铺ID"') ? 店铺ID : ""),
      }),
      first: () => ({
        isVisible: async () => true,
        innerText: async () => 店名,
        getAttribute: async () => (String(选择器).includes('label="店铺ID"') ? 店铺ID : ""),
      }),
    }),
  };
  return 头部;
}

function 造页面(店名, 店铺ID) {
  const page = {
    url: () => "https://fxg.jinritemai.com/ffa/morder/receipt/list",
    context: () => ({ pages: () => [page] }),
    waitForTimeout: async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20))),
    locator: () => ({ first: () => 造头部(店名, 店铺ID) }),
  };
  return page;
}

test("读取当前抖音店铺身份：顶部已渲染出店铺ID/店名时必须读得到（禁止再回退成 0 个有效店铺ID）", async () => {
  const 身份 = await 读取当前抖音店铺身份(造页面("德达医疗康养器械旗舰店", "162329841"));
  assert.deepEqual(身份, { storeId: "162329841", storeName: "德达医疗康养器械旗舰店" });
});

test("读取当前抖音店铺身份：读不到时必须抛错并带可诊断原因", async () => {
  const 空头部页面 = {
    url: () => "https://fxg.jinritemai.com/ffa/morder/receipt/list",
    context: () => ({ pages: () => [] }),
    waitForTimeout: async () => {},
    locator: () => ({
      first: () => ({
        waitFor: async () => {},
        evaluate: async () => ({}),
        locator: () => ({
          count: async () => 0,
          nth: () => ({ isVisible: async () => false, innerText: async () => "", getAttribute: async () => "" }),
        }),
      }),
    }),
  };
  await assert.rejects(读取当前抖音店铺身份(空头部页面), /读取抖音当前店铺名(称)?失败|读取抖音当前店铺 ID 失败/);
});

test("等待目标店铺：身份一直不匹配时必须在超时上限内报错（不许拖堂）", async () => {
  const 不匹配页面 = {
    url: () => "https://fxg.jinritemai.com/ffa/morder/receipt/list",
    context: () => ({ pages: () => [不匹配页面, 不匹配页面] }),
    waitForTimeout: async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20))),
    locator: () => ({
      first: () => ({
        count: async () => 1,
        isVisible: async () => true,
        waitFor: async () => {},
        evaluate: async () => ({}),
        locator: () => ({
          count: async () => 1,
          nth: () => ({ isVisible: async () => true, innerText: async () => "别的店", getAttribute: async () => "999" }),
        }),
      }),
    }),
  };
  const 开始时间 = Date.now();
  await assert.rejects(
    等待目标店铺(不匹配页面, { storeId: "162329841", storeName: "德达医疗康养器械旗舰店" }, 400),
    /等待抖音目标店铺超时/
  );
  assert.ok(Date.now() - 开始时间 < 5000, "必须在超时上限附近结束，不能无限拖");
});

test("源码反向断言：等待目标店铺逐页循环必须检查截止时间；身份读取失败必须留现场", () => {
  const 源码 = fs.readFileSync(path.join(__dirname, "..", "src", "browser", "douyinStoreIdentity.js"), "utf8");
  const 等待段 = 源码.slice(源码.indexOf("async function 等待目标店铺"), 源码.indexOf("async function 确保抖音目标店铺"));
  assert.match(等待段, /for \(const p of originPage\.context\(\)\.pages\(\)\) \{\s*\n\s*\/\/[^\n]*\n\s*if \(Date\.now\(\) > deadline\) break;/, "内层页循环必须有 deadline 检查");
  assert.match(等待段, /读取当前抖音店铺身份\(p, \{/, "轮询读取必须传短超时选项");

  const 身份段 = 源码.slice(源码.indexOf("async function 读取当前抖音店铺身份"), 源码.indexOf("async function 查找精确店铺选项"));
  assert.match(身份段, /记录店铺身份失败现场\(page, 错误\)/, "失败时必须留 DOM 现场，便于对比定性");
  assert.match(身份段, /头部等待毫秒/, "必须支持可配置超时");
});
