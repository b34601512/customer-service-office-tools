// 只读诊断：抖音店铺5 的「导出报表 → 下载落盘」全过程事件记录（找 download.saveAs 报 context closed 的机制）。
// 只读取待回传订单 + 下载抖音自己生成的导出报表；不上传、不提交、不改业务状态。
// 用法：node .codex-temporary/diag-douyin5-download.js
const fs = require("fs");
const path = require("path");

const 根 = path.resolve(__dirname, "..");
const 抖音项目 = path.join(根, "6.抖音发票回传");
process.chdir(抖音项目);

const 日志 = [];
function 记(文本) {
  const 行 = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${文本}`;
  日志.push(行);
  console.log("  " + 行);
  fs.writeFileSync(path.join(根, "runtime", "logs", "diag-douyin5-download.log"), 日志.join("\n") + "\n");
}

(async () => {
  const stores = require(path.join(抖音项目, "data", "stores.json"));
  const 店铺配置 = (Array.isArray(stores) ? stores : stores.stores || []).find((s) => s.id === "douyin-store-2");
  if (!店铺配置) throw new Error("找不到 douyin-store-2 店铺配置");

  const { 创建抖音账号浏览器上下文 } = require(path.join(抖音项目, "src/browser/douyinBrowserContext"));
  const { 打开抖音待回传发票页面, 读取当前页待回传订单, 导出抖音待回传订单 } = require(
    path.join(抖音项目, "src/invoiceReturn/douyinInvoicePage")
  );
  const { 抖音导出目录 } = require(path.join(抖音项目, "src/common/paths"));

  记(`店铺=${店铺配置.name}`);
  const context = await 创建抖音账号浏览器上下文(店铺配置, { headless: false });

  // 关键埋点：谁出现、谁关闭、下载从哪来
  context.on("page", (p) => {
    const 标 = (p) => `page#${p === null ? "?" : ""}`;
    记(`事件 context.page：新页面出现 url=${p.url()}`);
    p.on("close", () => 记(`事件 page.close：页面关闭 上面那个新页面`));
  });
  context.on("download", (d) => 记(`事件 context.download：${d.suggestedFilename()}`));
  context.on("close", () => 记("事件 context.close：整个上下文关闭（这会导致 saveAs 失败）"));
  for (const p of context.pages()) {
    p.on("close", () => 记(`事件 page.close：初始页面关闭 url=${p.url()}`));
    p.on("download", (d) => 记(`事件 page.download：${d.suggestedFilename()}`));
  }

  let page = context.pages().find((p) => !p.isClosed()) || (await context.newPage());
  page = await 打开抖音待回传发票页面(page, 店铺配置);
  记(`待回传页就绪 url=${page.url()}`);

  const 可见订单 = await 读取当前页待回传订单(page, 店铺配置);
  记(`读取当前页订单：${可见订单.length} 单`);
  if (!可见订单.length) {
    记("该店当前页没有待回传订单，诊断到此结束（不触发导出）");
    return;
  }

  // 包一层：在「导出」前后各记一次上下文/页面存活状态，直击 saveAs 失败瞬间
  const 原始导出 = 导出抖音待回传订单;
  try {
    const 文件 = await 原始导出(page, 抖音导出目录, { onAction: (m) => 记(`动作：${m}`) });
    记(`✅ 导出成功：${文件}`);
    记(`导出后 context.pages()=${context.pages().length} 个，主页面已关闭=${page.isClosed()}`);
  } catch (错误) {
    记(`❌ 导出失败：${错误 && 错误.message ? 错误.message : 错误}`);
    记(`失败瞬间：context.pages()=${context.pages().length} 个，主页面已关闭=${page.isClosed()}`);
    记(`所有页面 url=${JSON.stringify(context.pages().map((p) => p.url()))}`);
  }
})().catch((错误) => {
  console.error("  诊断脚本异常：" + (错误 && 错误.stack ? 错误.stack : 错误));
  process.exitCode = 1;
});
