// 批量巡检后台入口：不打开 TUI 交互界面，直接把「全部启用店铺巡检」跑一遍，结果照常写回后台数据与上次巡检记录。
// 跑完浏览器窗口保持打开供人工核对；你把窗口全部关掉后本进程自动退出（也可用 --跑完就退出）。
// 用法：node scripts/runBatchInspection.js [--跑完就退出]
const fs = require("fs");
const path = require("path");
const { 创建TUI } = require("../src/tui/startTui");
const { 获取活动浏览器上下文数量 } = require("../src/browser/browserContextHub");
const { 运行目录, 店铺结果文件路径 } = require("../src/common/paths");
const { 写入上次同步记录 } = require("../../共享CLI/上次同步记录");

const 跑完就退出 = process.argv.includes("--跑完就退出");
const 日志目录 = path.join(运行目录, "logs");
fs.mkdirSync(日志目录, { recursive: true });
const 时间戳 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const 日志文件 = path.join(日志目录, `batch-inspection-${时间戳}.log`);

function 输出(行) {
  // 业务日志会被 TUI 的日志页接管，这里用 stdout 直写，保证后台运行时也能看到进度。
  process.stdout.write(`${行}\n`);
  fs.appendFileSync(日志文件, `${行}\n`, "utf8");
}

function 创建静默输出() {
  return { writes: [], columns: 100, rows: 30, write() {}, on() {}, removeListener() {} };
}

async function 等待窗口关闭(超时毫秒 = 6 * 60 * 60 * 1000) {
  // 用户要求「跑完不要自动关浏览器」，所以进程留在这里等；窗口都关了就自动收尾。
  const 开始时间 = Date.now();
  let 上次心跳 = Date.now();
  while (Date.now() - 开始时间 < 超时毫秒) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const 数量 = 获取活动浏览器上下文数量();
    if (数量 === 0) return "浏览器窗口已全部关闭";
    if (Date.now() - 上次心跳 > 120000) {
      上次心跳 = Date.now();
      输出(`[保持打开] 仍有 ${数量} 个浏览器窗口，核对完直接关掉窗口即可`);
    }
  }
  return "等待窗口关闭超时";
}

async function main() {
  输出(`[启动] 京东开票巡检 · 批量巡检后台运行｜日志：${日志文件}`);
  const { app, dispose } = 创建TUI({ output: 创建静默输出() });
  app.running = true;
  // 把 TUI 日志页收到的一行行业务日志同步到 stdout 与文件，方便后台观察。
  const 日志页 = app.pages.find((页面) => 页面.key === "3");
  if (日志页 && typeof 日志页.pushLine === "function") {
    const 原始pushLine = 日志页.pushLine.bind(日志页);
    日志页.pushLine = (行) => {
      原始pushLine(行);
      const 文本 = String(行);
      process.stdout.write(`${文本}\n`);
      fs.appendFileSync(日志文件, `${文本}\n`, "utf8");
    };
  }

  try {
    await app.ctx.services.启动批量巡检();
  } catch (错误) {
    输出(`[失败] ${错误 instanceof Error ? 错误.message : String(错误)}`);
  }

  try {
    const 结果 = JSON.parse(fs.readFileSync(店铺结果文件路径, "utf8"));
    const 摘要 = 结果.lastRunSummary;
    if (摘要) {
      写入上次同步记录(path.join(运行目录, "state", "last-sync.json"), {
        at: 摘要.finishedAt,
        任务: "巡检",
        状态: 摘要.status === "success" ? "done" : "error",
        消息: `已检查 ${摘要.checkedStoreCount || 0}/${摘要.storeCount || 0} 家店铺。`,
        读取单数: 摘要.识别记录数,
        计数标签: `识别 ${摘要.识别记录数 || 0} 条｜新增 ${摘要.新增记录数 || 0} 条｜告警 ${摘要.告警记录数 || 0} 条`,
      });
      输出(`[汇总] 店铺 ${摘要.storeCount || 0} 家：成功 ${摘要.successStoreCount || 0}、失败 ${摘要.failedStoreCount || 0}、未完成 ${摘要.uncheckedStoreCount || 0}`
        + `｜识别 ${摘要.识别记录数 || 0} 条｜新增 ${摘要.新增记录数 || 0} 条｜告警 ${摘要.告警记录数 || 0} 条`);
      if (摘要.failedStoreNames?.length) 输出(`[失败店铺] ${摘要.failedStoreNames.join("、")}`);
      if (摘要.uncheckedStoreNames?.length) 输出(`[未完成店铺] ${摘要.uncheckedStoreNames.join("、")}`);
    } else {
      输出("[汇总] 没读到巡检摘要，请检查 data/store-results.json。");
    }
  } catch (错误) {
    输出(`[汇总失败] ${错误 instanceof Error ? 错误.message : String(错误)}`);
  }

  if (跑完就退出) {
    输出("[完成] 参数要求跑完就退出。");
  } else {
    输出("[完成] 浏览器窗口保持打开供核对；窗口全部关闭后本进程自动退出。");
    const 结束原因 = await 等待窗口关闭();
    输出(`[收尾] ${结束原因}，进程退出。`);
  }

  try {
    dispose();
  } catch {
    // 退出阶段的清理失败不影响结论。
  }
  process.exit(0);
}

main().catch((错误) => {
  输出(`[异常] ${错误?.stack || 错误}`);
  process.exit(1);
});
