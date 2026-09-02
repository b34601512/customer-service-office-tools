// TUI 入口：把巡检服务、店铺/订单仓库、日志总线与四个页面接在一起。
// 页面只消费 ctx.cache 的快照数据，服务动作统一走 ctx.services，避免页面直接触碰文件系统。
const { TUI应用 } = require("./共享路径").tuiApp;
const { 着色 } = require("./共享路径").ansi;
const { 适配宽度 } = require("./共享路径").width;
const { 格式化时长毫秒, 格式化任务状态 } = require("./共享路径").format;
const { 创建总览页 } = require("./pages/overview");
const { 创建店铺页 } = require("./pages/stores");
const { 创建日志页 } = require("./pages/logs");
const { 创建配置页 } = require("./pages/config");
const { 执行巡检 } = require("../app/checkInvoices");
const {
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
} = require("../store/storeConfigService");
const {
  读取店铺结果,
  更新店铺结果,
  更新最近巡检摘要,
} = require("../store/storeResultService");
const {
  同步巡检店铺结果,
  同步最近巡检结果,
} = require("../order/jdInspectionOrderStore");
const { 控制台捕获 } = require("./共享路径");
const { 开始捕获控制台输出 } = 控制台捕获;
const { 构建成功店铺结果, 构建失败店铺结果 } = require("../cli/inspectionResult");
const { 构建命令行巡检摘要 } = require("../cli/inspectionOverview");
const { 启动下载中心窗口, 读取下载中心外部服务状态 } = require("../../../共享CLI/启动下载中心");
const { 最大化当前控制台窗口 } = require("../../../../共享CLI/最大化控制台窗口");

const 标题 = "京东开票巡检控制台";

function 创建初始任务() {
  return {
    status: "idle",
    type: "",
    currentStore: "",
    message: "",
    startedAt: "",
    finishedAt: "",
  };
}

function 创建服务(ctx) {
  return {
    读取配置: () => 读取店铺配置(),
    保存配置: (配置) => 保存店铺配置(配置),
    读取结果: () => 读取店铺结果(),
    切换店铺启用状态: (店铺标识) => {
      const 当前配置 = 读取店铺配置();
      const 店铺 = 当前配置.stores.find((item) => item.id === 店铺标识);
      if (!店铺) throw new Error(`未找到店铺：${店铺标识}`);
      店铺.enabled = 店铺.enabled === false;
      保存店铺配置(当前配置);
      刷新缓存(ctx);
    },
    启动单店巡检: async (店铺) => {
      await 执行单店巡检(ctx, 店铺);
    },
    启动批量巡检: async () => {
      await 执行批量巡检(ctx);
    },
    打开下载中心: () => 启动下载中心窗口(),
    选择并巡检店铺: async () => {
      const 启用店铺 = 获取启用店铺列表();
      if (启用店铺.length === 0) throw new Error("当前没有启用中的店铺。");
      if (启用店铺.length === 1) {
        await 执行单店巡检(ctx, 启用店铺[0]);
        return;
      }
      throw new Error("请到「2店铺」页选中店铺后按回车启动单店巡检。");
    },
    requestExit: () => {
      ctx.app.stop();
      if (typeof 取消日志订阅 === "function") 取消日志订阅();
      清空定时器();
      process.exit(0);
    },
  };
}

let 取消日志订阅 = null;
let 恢复控制台输出 = null;
let 定时器列表 = [];

function 清空定时器() {
  定时器列表.forEach((定时器) => clearInterval(定时器));
  定时器列表 = [];
}

async function 执行单店巡检(ctx, 店铺) {
  const 开始时间 = new Date().toISOString();
  const 任务 = ctx.task;
  任务.status = "running";
  任务.type = "single";
  任务.currentStore = 店铺.name;
  任务.startedAt = 开始时间;
  任务.message = "正在打开浏览器…完成后保持打开供你核对。";
  ctx.app.requestRender();
  try {
    const 结果 = await 执行巡检({
      店铺配置: 店铺,
      headless: false,
      允许人工登录: true,
      巡检后保持页面打开: true,
      启用运行目录膨胀守卫: true,
    });
    const 店铺结果 = 构建成功店铺结果({ 店铺, 巡检结果: 结果 });
    更新店铺结果(店铺结果);
    同步巡检店铺结果(店铺结果);
    更新最近巡检摘要(构建命令行巡检摘要({
      执行类型: "single",
      开始时间,
      完成时间: 店铺结果.lastCheckedAt,
      店铺列表: [店铺],
      店铺结果列表: [店铺结果],
    }));
    任务.status = "done";
    任务.message = `巡检完成：${店铺结果.lastMessage}。浏览器保持打开，核对后关闭即可。`;
  } catch (错误) {
    const 店铺结果 = 构建失败店铺结果({ 店铺, 错误 });
    更新店铺结果(店铺结果);
    更新最近巡检摘要(构建命令行巡检摘要({
      执行类型: "single",
      开始时间,
      完成时间: 店铺结果.lastCheckedAt,
      店铺列表: [店铺],
      店铺结果列表: [店铺结果],
    }));
    任务.status = "error";
    任务.message = `巡检失败：${错误.message}`;
  } finally {
    任务.finishedAt = new Date().toISOString();
    任务.currentStore = "";
    刷新缓存(ctx);
    ctx.app.requestRender();
  }
}

async function 执行批量巡检(ctx) {
  const 店铺列表 = 获取启用店铺列表();
  if (!店铺列表.length) {
    throw new Error("当前没有启用中的店铺，请先编辑店铺配置。");
  }
  const 开始时间 = new Date().toISOString();
  const 任务 = ctx.task;
  const 本次店铺结果列表 = [];
  任务.status = "running";
  任务.type = "batch";
  任务.startedAt = 开始时间;
  任务.message = `开始批量巡检 ${店铺列表.length} 家店铺`;
  ctx.app.requestRender();

  for (const [索引, 店铺] of 店铺列表.entries()) {
    任务.currentStore = 店铺.name;
    任务.message = `正在处理第 ${索引 + 1}/${店铺列表.length} 家店铺`;
    ctx.app.requestRender();
    try {
      const 结果 = await 执行巡检({
        店铺配置: 店铺,
        headless: false,
        允许人工登录: false,
        登录失效自动转人工: true,
        页面保留模式: "keep",
        启用运行目录膨胀守卫: true,
      });
      const 店铺结果 = 构建成功店铺结果({ 店铺, 巡检结果: 结果 });
      本次店铺结果列表.push(店铺结果);
      更新店铺结果(店铺结果);
      同步巡检店铺结果(店铺结果);
    } catch (错误) {
      const 店铺结果 = 构建失败店铺结果({ 店铺, 错误 });
      本次店铺结果列表.push(店铺结果);
      更新店铺结果(店铺结果);
    }
  }

  const 摘要 = 构建命令行巡检摘要({
    执行类型: "batch",
    开始时间,
    完成时间: new Date().toISOString(),
    店铺列表,
    店铺结果列表: 本次店铺结果列表,
  });
  更新最近巡检摘要(摘要);
  任务.status = "done";
  任务.message = `已检查 ${本次店铺结果列表.length}/${店铺列表.length} 家店铺。浏览器窗口保持打开，可逐个核对。`;
  任务.finishedAt = new Date().toISOString();
  任务.currentStore = "";
  刷新缓存(ctx);
  ctx.app.requestRender();
}

function 构建状态栏(ctx, app) {
  const 任务 = ctx.task;
  const 任务状态 = 格式化任务状态(任务);
  const 行列表 = [];

  let 第一行 = `任务 ${着色(`[${任务状态.标签}]`, 任务状态.颜色)}`;
  if (任务.currentStore) {
    第一行 += `  当前：${任务.currentStore}`;
  }
  if (任务.status === "running" && 任务.startedAt) {
    第一行 += `  已运行 ${格式化时长毫秒(Date.now() - new Date(任务.startedAt).getTime())}`;
  }
  const 店铺数 = (ctx.cache.config?.stores || []).length;
  第一行 += `  店铺 ${店铺数} 家`;
  行列表.push(适配宽度(第一行, app.columns));

  if (任务.status === "running" && 任务.message) {
    行列表.push(着色(适配宽度(`   ${任务.message}`, app.columns), "brightYellow"));
  } else if (任务.message && 任务.status === "error") {
    行列表.push(着色(适配宽度(`   ${任务.message}`, app.columns), "brightRed"));
  } else if (任务.message) {
    行列表.push(着色(适配宽度(`   ${任务.message}`, app.columns), "gray"));
  } else {
    行列表.push(适配宽度("   使用说明：数字键切页；巡检在浏览器中可见执行，日志实时显示在「3日志」页。", app.columns));
  }

  return 行列表;
}

function 刷新缓存(ctx) {
  try {
    ctx.cache.config = 读取店铺配置();
    ctx.cache.results = 读取店铺结果();
  } catch (错误) {
    // 缓存刷新失败不打断 TUI，下一页渲染仍展示最后一次成功快照。
  }
}

function 创建TUI(选项 = {}) {
  const 页面列表 = [
    创建总览页(),
    创建店铺页(),
    创建日志页(),
    创建配置页(),
  ];
  const 日志页 = 页面列表.find((页面) => 页面.key === "3");

  const ctx = {
    task: 选项.task || 创建初始任务(),
    cache: {
      config: null,
      results: null,
      serviceStatus: null,
    },
  };

  const app = new TUI应用({
    title: 标题,
    pages: 页面列表,
    output: 选项.output,
    onExitRequest: () => {
      ctx.services.requestExit();
    },
    statusBarProvider: (tuiApp) => 构建状态栏(ctx, tuiApp),
  });
  app.ctx = ctx;
  ctx.app = app;
  ctx.services = 创建服务(ctx);

  页面列表.forEach((页面) => {
    页面.ctx = ctx;
  });

  // 日志通道：业务 console 输出全部重定向进日志页（屏幕不被污染），退出时恢复。
  const 记录日志行 = (行) => {
    日志页.pushLine(行);
    app.requestRender();
  };
  恢复控制台输出 = 开始捕获控制台输出(记录日志行);

  const 刷新缓存并渲染 = () => {
    刷新缓存(ctx);
    app.requestRender();
  };

  let 服务状态检查中 = false;
  const 刷新外部服务状态 = async () => {
    if (服务状态检查中) return;
    服务状态检查中 = true;
    if (!ctx.cache.serviceStatus) {
        ctx.cache.serviceStatus = { name: "下载中心", status: "checking", label: "检查中" };
      }
    app.requestRender();
    try {
      ctx.cache.serviceStatus = await 读取下载中心外部服务状态();
    } catch (错误) {
      ctx.cache.serviceStatus = {
        name: "下载中心",
        status: "error",
        label: "失效",
        detail: String(错误?.message || 错误 || "健康检查失败"),
      };
    } finally {
      服务状态检查中 = false;
      app.requestRender();
    }
  };

  const 时钟定时器 = setInterval(() => app.requestRender(), 1000);
  const 缓存定时器 = setInterval(刷新缓存并渲染, 3000);
  const 服务状态定时器 = setInterval(() => { 刷新外部服务状态(); }, 10000);
  定时器列表.push(时钟定时器, 缓存定时器, 服务状态定时器);
  if (typeof 时钟定时器.unref === "function") 时钟定时器.unref();
  if (typeof 缓存定时器.unref === "function") 缓存定时器.unref();
  if (typeof 服务状态定时器.unref === "function") 服务状态定时器.unref();

  // 首屏数据先取一次，避免用户进入 TUI 时看到空白面板。
  刷新缓存(ctx);
  刷新外部服务状态();

  return {
    app,
    ctx,
    dispose() {
      if (typeof 取消日志订阅 === "function") 取消日志订阅();
      if (typeof 恢复控制台输出 === "function") 恢复控制台输出();
      清空定时器();
    },
  };
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
  构建状态栏,
  执行单店巡检,
  执行批量巡检,
  创建初始任务,
};
