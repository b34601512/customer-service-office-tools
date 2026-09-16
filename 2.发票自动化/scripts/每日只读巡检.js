// 每日只读发票巡检：一次跑完发票自动化的 5 个子项目，只读不提交。
// 严格只读：不下载发票、不上传、不提交、不回传；不修改任何订单的人工处理状态。
// 用法：
//   node scripts/每日只读巡检.js                # 三步全跑
//   node scripts/每日只读巡检.js --跳过京东开票   # 跳过第 1 步
//   node scripts/每日只读巡检.js --跳过京东催票   # 跳过第 2 步
//   node scripts/每日只读巡检.js --跳过平台同步   # 跳过第 3 步
// 每步都有墙钟上限，超时按失败记录并继续下一步，绝不无限等待。
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const 项目根 = path.resolve(__dirname, "..");
const 参数 = process.argv.slice(2);
const 跳过 = {
  京东开票: 参数.includes("--跳过京东开票"),
  京东催票: 参数.includes("--跳过京东催票"),
  平台同步: 参数.includes("--跳过平台同步")
};

// 每步墙钟上限（毫秒）：到点就判失败并往下走，避免"没有输出也没有报错"的静默卡死。
const 上限 = {
  京东开票: 20 * 60 * 1000,
  京东催票: 25 * 60 * 1000,
  平台同步: 30 * 60 * 1000
};

function 记(文本) {
  process.stdout.write(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${文本}\n`);
}

function 跑子进程(命令, 参数列表, 工作目录, 毫秒上限, 步骤名) {
  return new Promise((完成) => {
    // 说明：命令一律用 process.execPath（当前 node 绝对路径）——
    // 既不要 shell:true（Windows 下会去 spawn cmd.exe，某些环境 ENOENT），
    // 也不要裸写 "node"（无 shell 时不会走 PATHEXT，同样 ENOENT）。两次都实际踩到过。
    const 子进程 = spawn(命令, 参数列表, { cwd: 工作目录, stdio: "inherit" });
    let 已收尾 = false;
    const 定时器 = setTimeout(() => {
      if (已收尾) return;
      已收尾 = true;
      记(`!! ${步骤名} 超过墙钟上限 ${Math.round(毫秒上限 / 60000)} 分钟，按失败处理并终止该步`);
      try { 子进程.kill("SIGKILL"); } catch (_) { /* 忽略 */ }
      完成({ 状态: "超时", 退出码: null });
    }, 毫秒上限);
    子进程.on("exit", (退出码) => {
      if (已收尾) return;
      已收尾 = true;
      clearTimeout(定时器);
      完成({ 状态: 退出码 === 0 ? "成功" : "失败", 退出码 });
    });
    子进程.on("error", (错误) => {
      if (已收尾) return;
      已收尾 = true;
      clearTimeout(定时器);
      记(`!! ${步骤名} 启动失败：${错误.message}`);
      完成({ 状态: "失败", 退出码: null });
    });
  });
}

// 第 1 步：京东开票巡检（逐店巡检"待开票"入口，只读识别）
async function 第一步_京东开票巡检() {
  if (跳过.京东开票) return { 步骤: "京东开票巡检", 状态: "已跳过" };
  记("== 第 1 步：京东开票巡检（5 家店，只读识别）==");
  const 结果 = await 跑子进程(
    process.execPath,
    [path.join(项目根, "1.京东开票巡检/scripts/runBatchInspection.js"), "--跑完就退出"],
    path.join(项目根, "1.京东开票巡检"),
    上限.京东开票,
    "京东开票巡检"
  );
  return { 步骤: "京东开票巡检", ...结果 };
}

// 第 2 步：京东催票识别（等价 TUI「自动识别全部启用店铺」，串行逐店）
async function 第二步_京东催票识别() {
  if (跳过.京东催票) return { 步骤: "京东催票识别", 状态: "已跳过" };
  记("== 第 2 步：京东催票识别（等价 TUI「自动识别全部启用店铺」）==");
  const 京东目录 = path.join(项目根, "2.京东发票回传");
  const { ControlCenterState } = require(path.join(京东目录, "src/controlCenter/controlCenterState"));
  const { ControlCenterTaskService } = require(path.join(京东目录, "src/controlCenter/taskService"));
  const { 读取店铺结果 } = require(path.join(京东目录, "src/store/storeResultService"));
  const { 读取订单记录, 记录转列表 } = require(path.join(京东目录, "src/order/jdOrderRecordStore"));
  const state = new ControlCenterState(读取店铺结果(), 记录转列表(读取订单记录()));
  const 任务服务 = new ControlCenterTaskService(state);
  任务服务.启动全部排查();
  const 墙钟截止 = Date.now() + 上限.京东催票;
  while (任务服务.running && Date.now() < 墙钟截止) {
    await new Promise((等待) => setTimeout(等待, 1000));
  }
  if (任务服务.running) {
    记("!! 京东催票识别超过墙钟上限，按失败处理");
    try { await 任务服务.shutdownAllRunningTasks("只读巡检墙钟上限"); } catch (_) { /* 忽略 */ }
    return { 步骤: "京东催票识别", 状态: "超时", 退出码: null };
  }
  const 最终任务 = state.currentTask || {};
  const 失败 = /失败/.test(String(最终任务.status || "")) || /失败/.test(String(最终任务.label || ""));
  记(`   任务收口：${最终任务.label || "-"}｜${最终任务.message || "-"}`);
  return { 步骤: "京东催票识别", 状态: 失败 ? "失败" : "成功", 退出码: 0, 备注: 最终任务.message || "" };
}

// 第 3 步：天猫 / 拼多多 / 抖音 待处理订单只读同步
async function 第三步_平台只读同步() {
  if (跳过.平台同步) return { 步骤: "天猫/拼多多/抖音只读同步", 状态: "已跳过" };
  记("== 第 3 步：天猫 / 拼多多 / 抖音 待处理订单只读同步 ==");
  const 结果 = await 跑子进程(
    process.execPath,
    [path.join(项目根, ".codex-temporary/readonly-sync.js"), "all"],
    // 项目根 就是发票自动化根目录（脚本在 scripts/ 下），这里不要再拼一层，
    // 否则 cwd 指向不存在的目录，spawn 会报 ENOENT（2026-09-16 实际踩到）。
    项目根,
    上限.平台同步,
    "平台只读同步"
  );
  return { 步骤: "天猫/拼多多/抖音只读同步", ...结果 };
}

// 汇总：读本地订单记录，给出"需要处理的发票"清单
function 读取平台汇总() {
  const 平台定义 = [
    { 名称: "京东", 目录: "2.京东发票回传", 模块: "src/order/jdOrderRecordStore" },
    { 名称: "天猫", 目录: "4.天猫发票回传", 模块: "src/order/tmallOrderRecordStore" },
    { 名称: "拼多多", 目录: "5.拼多多发票回传", 模块: "src/order/pddOrderRecordStore" },
    { 名称: "抖音", 目录: "6.抖音发票回传", 模块: "src/order/douyinOrderRecordStore" }
  ];
  const 汇总 = [];
  for (const 平台 of 平台定义) {
    try {
      const 模块 = require(path.join(项目根, 平台.目录, 平台.模块));
      const 列表 = 模块.读取订单列表 ? 模块.读取订单列表() : 模块.记录转列表(模块.读取订单记录());
      const 计数 = {};
      列表.forEach((订单) => {
        const 状态 = String(订单.workflowStatus || "未知");
        计数[状态] = (计数[状态] || 0) + 1;
      });
      汇总.push({ 平台: 平台.名称, 总数: 列表.length, 计数, 列表 });
    } catch (错误) {
      汇总.push({ 平台: 平台.名称, 总数: 0, 计数: {}, 列表: [], 错误: 错误.message });
    }
  }
  return 汇总;
}

function 打印待处理清单(汇总) {
  记("");
  记("================ 待处理发票清单（只读汇总）================");
  let 待处理总数 = 0;
  汇总.forEach((平台) => {
    const 待处理 = 平台.列表.filter((订单) => String(订单.workflowStatus || "") === "pending");
    待处理总数 += 待处理.length;
    const 计数文字 = Object.keys(平台.计数).length
      ? Object.entries(平台.计数).map(([键, 值]) => `${键}=${值}`).join(" ")
      : "无记录";
    记(`${平台.平台}：共 ${平台.总数} 条｜${计数文字}｜待处理(pending)=${待处理.length}`);
    待处理.forEach((订单) => {
      const 金额 = 订单.invoiceAmountText || 订单.invoiceAmount || "";
      const 申请时间 = 订单.invoiceApplicationTime || 订单.invoiceApplyTime || "";
      const 店铺 = 订单.storeName || order_storeName(订单) || "";
      const 单号 = 订单.orderNumber || "";
      const 标题 = String(订单.invoiceTitle || "").slice(0, 24);
      记(`   - ${平台.平台}｜${店铺}｜单号 ${单号}｜${金额}｜申请 ${申请时间}｜抬头 ${标题 || "(无)"}`);
    });
  });
  记(`待处理合计 = ${待处理总数} 单`);
  return 待处理总数;
}

function order_storeName(订单) {
  return 订单.storeName || "";
}

async function main() {
  记(`每日只读发票巡检开始（${new Date().toLocaleString("zh-CN", { hour12: false })}）`);
  const 步骤结果 = [];
  步骤结果.push(await 第一步_京东开票巡检());
  步骤结果.push(await 第二步_京东催票识别());
  步骤结果.push(await 第三步_平台只读同步());

  const 汇总 = 读取平台汇总();
  const 待处理总数 = 打印待处理清单(汇总);

  记("");
  记("================ 步骤结果 ================");
  步骤结果.forEach((项) => 记(`${项.步骤}：${项.状态}${项.退出码 !== null && 项.退出码 !== undefined ? `（退出码 ${项.退出码}）` : ""}`));
  const 失败步 = 步骤结果.filter((项) => ["失败", "超时"].includes(项.状态));
  记(`待处理合计=${待处理总数} 单；失败步骤=${失败步.length}`);
  记(`P2_RESULT=${失败步.length === 0 ? "SUCCESS" : "PARTIAL"}`);
  process.exit(0);
}

main().catch((错误) => {
  记(`只读巡检异常终止：${(错误 && 错误.stack) || 错误}`);
  记("P2_RESULT=FAILED");
  process.exit(1);
});
