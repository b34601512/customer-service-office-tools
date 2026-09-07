// 抖音发票回传 TUI 入口：复用共享回传平台模板，绑定抖音专属服务。
const fs = require("fs");
const { 加载共享框架 } = require("./共享路径");
const { 创建回传平台TUI } = 加载共享框架("回传平台TUI.js");
const {
  读取店铺配置,
  保存店铺配置,
  检测重复账号配置,
} = require("../store/storeConfigService");
const { 逐店同步并回传 } = require('../app/processStores');
const {
  读取订单列表,
  更新订单工作流状态,
} = require("../order/douyinOrderRecordStore");
const { 获取账号浏览器资料目录 } = require("../browser/accountProfilePaths");
const { 关闭所有已打开抖音浏览器上下文 } = require("../browser/douyinBrowserContext");
const { 启动下载中心窗口, 读取下载中心外部服务状态 } = require("../../../共享CLI/启动下载中心");
const { 最大化当前控制台窗口 } = require("../../../../共享CLI/最大化控制台窗口");

const 标题 = "抖音发票回传控制台";

function 读取本地登录状态(店铺) {
  if (!店铺.phoneNumber) return { status: "missing", label: "未配置手机号", 标签: "未配置手机号" };
  const 资料目录 = 获取账号浏览器资料目录(店铺);
  return fs.existsSync(资料目录)
    ? { status: "ready", 标签: "已有本地资料" }
    : { status: "missing", 标签: "未发现本地资料" };
}

function 创建TUI(选项 = {}) {
  const tui = 创建回传平台TUI({
    标题,
    output: 选项.output,
    读取店铺配置,
    保存店铺配置,
    读取登录状态: 读取本地登录状态,
    总览附加行: (ctx) => {
      const stores = ctx?.cache?.config?.stores || [];
      const 启用 = stores.filter(s => s.enabled !== false);
      const 重复账号 = 检测重复账号配置(启用);
      // 同手机号多店若已配置 platformStoreId 则为正常切店场景，不告警
      const 需告警 = 重复账号.filter(acc => 启用.filter(s => String(s.username||s.phoneNumber).trim()===acc).some(s=>!String(s.platformStoreId||'').trim()));
      if (需告警.length) {
        const { 着色 } = require("../../../共享CLI/tui/ansi");
        const { 适配宽度 } = require("../../../共享CLI/tui/width");
        return [着色(适配宽度(`⚠ 重复账号未配置切店：${需告警.join('、')} 请在 data/stores.json 补充 platformStoreId/platformStoreName` , ctx.app ? ctx.app.columns : 80), "brightYellow")];
      }
      if (重复账号.length) {
        const { 着色 } = require("../../../共享CLI/tui/ansi");
        const { 适配宽度 } = require("../../../共享CLI/tui/width");
        return [着色(适配宽度(`同号多店已启用切店：${重复账号.join('、')} 将自动切换店铺`, ctx.app ? ctx.app.columns : 80), "gray")];
      }
      return null;
    },
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
          const result = await 逐店同步并回传({
            onProgress: (progress) => { 上下文.task.message = progress.message; },
          });
          上下文.task.message = result.message;
        });
      },
    },
    配置提示: "新增、修改、删除店铺请使用 CLI 模式：node src/cli/startCli.js",
  });
  // 浏览器生命周期：除非退出程序，否则不自动关闭；已打开的浏览器在进程内复用，退出时统一关闭。
  const 原始请求退出 = tui.ctx.services.requestExit;
  tui.ctx.services.requestExit = async () => {
    try { await 关闭所有已打开抖音浏览器上下文(); } catch {}
    原始请求退出();
  };
  const 原始销毁 = tui.dispose;
  const 增强销毁 = async () => {
    try { await 关闭所有已打开抖音浏览器上下文(); } catch {}
   原始销毁();
  };
  return { app: tui.app, ctx: tui.ctx, dispose: 增强销毁, 关闭所有浏览器: 关闭所有已打开抖音浏览器上下文 };
}

if (require.main === module) {
  最大化当前控制台窗口();
  const { app, dispose } = 创建TUI();
  const 安全退出 = async () => {
    try { await dispose(); } catch {}
    process.exit(0);
  };
  process.once("SIGINT", 安全退出);
  process.once("SIGBREAK", 安全退出);
  process.once("SIGHUP", 安全退出);
  process.once("SIGTERM", 安全退出);
  app.start();
}

module.exports = {
  创建TUI,
  读取本地登录状态,
};
