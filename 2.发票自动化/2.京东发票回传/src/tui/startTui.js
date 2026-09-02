// 京东发票回传 TUI 入口：复用共享回传平台模板，绑定催票识别与发票回传后台任务。
const fs = require("fs");
const { 加载共享框架 } = require("./共享路径");
const { 创建回传平台TUI } = 加载共享框架("回传平台TUI.js");
const {
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
} = require("../store/storeConfigService");
const { 读取店铺结果 } = require("../store/storeResultService");
const {
  读取订单记录,
  记录转列表,
  统计订单记录,
  设置订单处理中状态,
  是平台待开票待回传订单,
} = require("../order/jdOrderRecordStore");
const { 获取店铺登录态文件路径 } = require("../common/paths");
const { 关闭全部浏览器上下文 } = require("../browser/browserContextHub");
const { ControlCenterState } = require("../controlCenter/controlCenterState");
const { ControlCenterTaskService } = require("../controlCenter/taskService");
const { 启动下载中心窗口, 读取下载中心外部服务状态 } = require("../../../共享CLI/启动下载中心");
const { 最大化当前控制台窗口 } = require("../../../../共享CLI/最大化控制台窗口");

const 标题 = "京东发票回传控制台";

function 读取本地登录状态(店铺) {
  return fs.existsSync(获取店铺登录态文件路径(店铺.id))
    ? { status: "ready", 标签: "已有登录态文件" }
    : { status: "missing", 标签: "未发现登录态文件" };
}

function 格式化最近结果(结果) {
  if (!结果) return "暂无识别记录";
  return `${结果.lastCheckedAt || "时间未知"}｜${结果.lastMessage || 结果.status || "已执行"}`;
}

function 创建任务服务() {
  const state = new ControlCenterState(读取店铺结果(), 记录转列表(读取订单记录()));
  return new ControlCenterTaskService(state);
}

function 确认后台任务结果(当前任务) {
  // 解决：TUI 只认任务服务的结构化最终状态，失败不得被外层当成完成。
  if (当前任务?.status === "error") {
    throw new Error(当前任务.errorMessage || 当前任务.message || "后台任务失败。");
  }
  return 当前任务 || null;
}

async function 运行后台任务(上下文, 启动函数, 保留页面 = false) {
  const 任务服务 = 创建任务服务();
  try {
    await 启动函数(任务服务);
    // 轮询等待任务结束；期间每秒把任务状态同步到 TUI 状态栏。
    while (任务服务.running) {
      const 当前任务 = 任务服务.state?.currentTask;
      if (当前任务?.message) {
        上下文.task.message = 当前任务.message;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const 最终任务 = 任务服务.state?.currentTask || null;
    if (最终任务?.message) {
      上下文.task.message = 最终任务.message;
    }
    return 确认后台任务结果(最终任务);
  } finally {
    // 保留页面时任务结束不做自动清理，已打开的浏览器页面一直保持，直到退出程序统一关闭。
    if (!保留页面) {
      await 任务服务.shutdownAllRunningTasks("TUI 任务结束");
    }
  }
}

function 创建TUI(选项 = {}) {
  const 结果 = 创建回传平台TUI({
    标题,
    output: 选项.output,
    读取店铺配置,
    保存店铺配置,
    读取登录状态: 读取本地登录状态,
      读取店铺订单: (店铺) => 记录转列表(读取订单记录()).filter((订单) => String(订单.storeId || "") === String(店铺.id)),
      读取全部订单: () => 记录转列表(读取订单记录()),
    订单页扩展列: [
      { 标题: "申请日期", 宽度: 12, 取值: (镜像) => 镜像.原订单?.invoiceApplicationTime || "-" },
      { 标题: "开票倒计时", 宽度: 16, 取值: (镜像) => 镜像.原订单?.invoiceCountdownText || "-" },
      { 标题: "发票状态", 宽度: 14, 取值: (镜像) => 镜像.原订单?.invoiceStatusText || "-" },
      { 标题: "发票金额", 宽度: 12, 取值: (镜像) => 镜像.原订单?.invoiceAmountText || "-" },
    ],
    打开下载中心: () => 启动下载中心窗口(),
    外部服务名称: "下载中心",
    读取外部服务状态: 读取下载中心外部服务状态,
    格式化结果: (店铺) => 格式化最近结果(读取店铺结果().stores?.[店铺.id]),
    总览附加行: (上下文) => {
      try {
        const 订单数据 = 读取订单记录();
        const 统计 = 统计订单记录(订单数据);
        return [`订单：共 ${统计.total} 条（待处理 ${统计.pending ?? 0}｜处理中 ${统计.processing ?? 0}｜已登记 ${统计.invoiceRegistered ?? 0}｜已处理 ${统计.handled ?? 0}）`];
      } catch (错误) {
        return [];
      }
    },
    快捷操作: [
      { id: "auto-check", 标签: "自动识别全部启用店铺", 提示: "浏览器可见，逐店执行催票识别" },
      { id: "return", 标签: "批量回传待开票发票", 提示: "浏览器可见，回传京东后台待开票订单的发票并写回状态" },
    ],
    操作动作: {
      "auto-check": async (上下文) => {
        await 上下文.services.启动任务(async () => {
          上下文.task.message = "正在启动自动识别全部启用店铺…";
          await 运行后台任务(上下文, async (任务服务) => {
            任务服务.启动全部排查();
          });
          上下文.task.message = "自动识别已结束。";
        });
      },
      "return": async (上下文) => {
        await 上下文.services.启动任务(async () => {
          const 待回传订单 = 记录转列表(读取订单记录()).filter(是平台待开票待回传订单);
          if (!待回传订单.length) throw new Error("当前没有京东后台待开票且待回传的订单。");
          上下文.task.message = `开始批量回传 ${待回传订单.length} 张待开票发票…`;
          const 任务结果 = await 运行后台任务(上下文, async (任务服务) => {
            任务服务.启动待开票发票批量回传();
          }, true);
          上下文.task.message = `${任务结果.message} 京东页面保持打开供核对；退出控制台时自动关闭。`;
        });
      },
    },
    订单页标记已安排: (订单) => {
      if (订单.workflowStatus !== "pending") return null;
      return 设置订单处理中状态(订单.key, true);
    },
    店铺页操作提示: " r单店识别",
    店铺页回车动作: (app, 店铺) => {
      app.ctx.services.启动任务(async (上下文) => {
        上下文.task.currentStore = 店铺.name;
        上下文.task.message = `正在打开 ${店铺.name} 的真实登录页面；验证码等环节请在浏览器完成。`;
        await 运行后台任务(上下文, async (任务服务) => {
          任务服务.启动单店排查(店铺.id);
        });
        上下文.task.message = `单店识别完成：${店铺.name}。`;
      });
    },
    配置提示: "新增、修改、删除店铺与客服名单请使用 CLI 模式：npm run panel:cli",
  });
  // 包装退出：退出程序时统一关闭仍保持打开的浏览器页面，避免留下孤儿窗口。
  const 原请求退出 = 结果.ctx.services.requestExit.bind(结果.ctx.services);
  结果.ctx.services.requestExit = () => {
    关闭全部浏览器上下文().catch(() => {}).finally(() => 原请求退出());
  };
  return 结果;
}

if (require.main === module) {
  最大化当前控制台窗口();
  const { app, dispose } = 创建TUI();
  let 退出中 = false;
  const 处理退出 = async () => {
    if (退出中) return;
    退出中 = true;
    // 退出 JD 控制台时关闭 JD 页面；下载中心服务继续持有诺诺会话，避免下次启动重新登录。
    await 关闭全部浏览器上下文().catch(() => {});
    dispose();
    process.exit(0);
  };
  process.once("SIGINT", 处理退出);
  process.once("SIGTERM", 处理退出);
  app.start();
}

module.exports = {
  创建TUI,
  读取本地登录状态,
  格式化最近结果,
  确认后台任务结果,
};
