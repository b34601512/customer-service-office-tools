// 拼多多发票回传 TUI 入口：复用共享回传平台模板，绑定拼多多专属服务。
const fs = require("fs");
const path = require("path");
const { 加载共享框架 } = require("./共享路径");
const { 创建回传平台TUI } = 加载共享框架("回传平台TUI.js");
const 共享回传工作台模块路径 = [
  path.resolve(__dirname, "../../../共享CLI/platformReturnWorkbench.js"),
  path.resolve(__dirname, "../../共享CLI/platformReturnWorkbench.js"),
].find((模块路径) => fs.existsSync(模块路径));
if (!共享回传工作台模块路径) throw new Error("找不到共享平台回传工作台模块。");
const { 创建平台回传CLI动作 } = require(共享回传工作台模块路径);
const {
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
} = require("../store/storeConfigService");
const { 同步拼多多待处理订单 } = require("../app/syncPendingOrders");
const { 执行拼多多发票正式回传 } = require("../app/returnInvoiceToPdd");
const {
  读取订单列表,
  读取店铺发票已登记订单,
  更新订单工作流状态,
  设置订单备注,
  设置订单回传尝试,
} = require("../order/pddOrderRecordStore");
const { 获取店铺账号浏览器资料目录 } = require("../browser/storeProfilePaths");
const { 启动下载中心窗口, 读取下载中心外部服务状态 } = require("../../../共享CLI/启动下载中心");
const { 最大化当前控制台窗口 } = require("../../../../共享CLI/最大化控制台窗口");

const 标题 = "拼多多发票回传控制台";

// TUI 无屏工作台上下文：回传工作台的页面重绘全部转空操作，明细走 console 被日志页捕获。
const 工作台上下文 = {
  输出: () => {},
  终端: {
    显示页面: () => {},
    清屏: () => {},
    输出标题: () => {},
    主题: { 成功: (文本) => 文本, 失败: (文本) => 文本, 弱化: (文本) => 文本, 提醒: (文本) => 文本, 强调: (文本) => 文本 },
  },
  提问器: { 询问: async () => "" },
  记录运行日志: () => {},
};

const 回传工作台 = 创建平台回传CLI动作({
  platformName: "拼多多",
  获取启用店铺列表,
  同步单个店铺: 同步拼多多待处理订单,
  读取订单列表,
  读取店铺发票已登记订单,
  更新订单工作流状态,
  设置订单备注,
  执行正式回传: 执行拼多多发票正式回传,
  设置订单回传尝试,
  回传要求已登记: false,
});

function 读取本地登录状态(店铺) {
  const 资料目录 = 获取店铺账号浏览器资料目录({
    storeId: 店铺.id,
    username: 店铺.username,
  });
  return fs.existsSync(资料目录)
    ? { status: "ready", 标签: "已有本地资料" }
    : { status: "missing", 标签: "未发现本地资料" };
}

function 创建TUI(选项 = {}) {
  return 创建回传平台TUI({
    标题,
    output: 选项.output,
    读取店铺配置,
    保存店铺配置,
    读取登录状态: 读取本地登录状态,
      读取店铺订单: (店铺) => 读取订单列表().filter((订单) => String(订单.storeId || "") === String(店铺.id)),
      读取全部订单: () => 读取订单列表(),
    订单页扩展列: [
      { 标题: "申请日期", 宽度: 12, 取值: (镜像) => 镜像.原订单?.invoiceApplyTime || "-" },
      { 标题: "开票倒计时", 宽度: 16, 取值: (镜像) => 镜像.原订单?.invoiceCountdownText || "-" },
      { 标题: "后台状态", 宽度: 16, 取值: (镜像) => 镜像.原订单?.operationStatus || "-" },
      { 标题: "发票金额", 宽度: 12, 取值: (镜像) => 镜像.原订单?.invoiceAmount || "-" },
    ],
    订单页标记已安排: (订单) => {
      if (订单.workflowStatus !== "pending") return null;
      return 更新订单工作流状态(订单.key, "processing");
    },
    打开下载中心: () => 启动下载中心窗口(),
    外部服务名称: "下载中心",
    读取外部服务状态: 读取下载中心外部服务状态,
    订阅日志: 选项.订阅日志,
    快捷操作: [
      { id: "return", 标签: "发票回传（自动登录并回传）", 提示: "自动登录后同步待处理订单并回传发票" },
    ],
    操作动作: {
      "return": async (上下文) => {
        await 上下文.services.启动任务(async () => {
          const 启用店铺 = 获取启用店铺列表();
          if (!启用店铺.length) throw new Error("当前没有启用中的店铺。");
          上下文.task.message = "开始自动登录并回传发票…";
          await 回传工作台.同步待处理订单(工作台上下文, 启用店铺);
          await 回传工作台.正式回传(工作台上下文, 启用店铺);
          上下文.task.message = "发票回传流程已结束。";
        });
      },
    },
    配置提示: "新增、修改、删除店铺请使用 CLI 模式：npm run panel:cli",
  });
}

if (require.main === module) {
  最大化当前控制台窗口();
  const { app, dispose } = 创建TUI();
  process.once("SIGINT", () => {
    dispose();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    dispose();
    process.exit(0);
  });
  app.start();
}

module.exports = {
  创建TUI,
  读取本地登录状态,
};
