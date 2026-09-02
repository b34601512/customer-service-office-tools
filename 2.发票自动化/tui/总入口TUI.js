// 发票自动化统一总控制台 TUI：
// 一个总览页看全部平台状态，一个下载中心页看诺诺登录与服务状态；
// 平台任务仍按原有方式在独立窗口运行，保持故障隔离和浏览器人工登录能力。
const path = require("path");
const fs = require("fs");

function 解析共享框架文件(文件名) {
  const 候选列表 = [
    path.resolve(__dirname, "../共享CLI/tui", 文件名),
  ];
  const 目标 = 候选列表.find((候选) => fs.existsSync(候选));
  if (!目标) throw new Error(`找不到共享 TUI 框架文件：${文件名}`);
  return 目标;
}

function 加载共享框架(文件名) {
  return require(解析共享框架文件(文件名));
}

const { TUI应用 } = 加载共享框架("tuiApp.js");
const { 着色 } = 加载共享框架("ansi.js");
const { 适配宽度 } = 加载共享框架("width.js");
const { 格式化任务状态, 格式化时间文本 } = 加载共享框架("format.js");
const {
  子项目定义列表,
  启动子项目,
  检查子项目入口,
} = require("../总入口");
const {
  读取下载中心状态摘要,
} = require("../共享CLI/平台状态汇总");
const {
  启动下载中心窗口,
  启动下载中心服务,
  读取下载中心外部服务状态,
} = require("../共享CLI/启动下载中心");
const { 打开文件夹 } = require("../共享CLI/打开文件夹");

const 标题 = "发票自动化总控制台";
const 下载中心目录名称 = "3.通用发票下载中心";

function 构建平台状态行(app, 平台状态, 是否选中) {
  const 列数 = app.columns;
  const 入口文字 = 平台状态.ok ? 着色("[可用]", "brightGreen") : 着色("[缺失]", "brightRed");
  // 总控制台首页只做入口和可用性判断；店铺/订单明细进入各平台控制台后查看。
  const 行 = `  [${平台状态.菜单编号}] ${平台状态.项目名称} ${入口文字}`;
  return 是否选中 ? 着色(适配宽度(行, 列数), "reverse") : 适配宽度(行, 列数);
}

function 构建服务状态行列表(app, 服务状态) {
  const 列数 = app.columns;
  const 行列表 = [];
  const 条目列表 = Array.isArray(服务状态?.items) && 服务状态.items.length > 0
    ? 服务状态.items
    : [服务状态];
  for (const 条目 of 条目列表) {
    if (!条目) continue;
    const 状态 = String(条目.status || "unknown");
    const 颜色 = 状态 === "ready" ? "brightGreen" : (状态 === "checking" ? "brightYellow" : "brightRed");
    const 名称 = String(条目.name || 服务状态?.name || "下载中心");
    const 标签 = String(条目.label || (状态 === "ready" ? "可用" : 状态 === "checking" ? "检查中" : "不可用"));
    const 详情 = 条目.detail ? `｜${条目.detail}` : "";
    行列表.push(`${名称}：${着色("●", 颜色)} ${着色(标签, 颜色)}${详情}`);
  }
  行列表.push(适配宽度("", 列数));
  return 行列表;
}

function 创建TUI(选项 = {}) {
  const 状态 = {
    selection: 0,
    downloadSelection: 0,
    message: "",
    downloadMessage: "",
    lastLaunched: null,
    lastLaunchedAt: "",
  };

  const ctx = {
    cache: {
      platformStatuses: [],
      serviceStatus: null,
      downloadCenterSummary: null,
    },
    services: {},
  };

  const 总览页 = {
    key: "1",
    title: "总览",
    onEnter() {
      if (状态.selection >= 子项目定义列表.length) {
        状态.selection = 0;
      }
    },
    render(app) {
      const 列数 = app.columns;
      const 平台状态列表 = Array.isArray(ctx.cache.platformStatuses) && ctx.cache.platformStatuses.length > 0
        ? ctx.cache.platformStatuses
        : 子项目定义列表.map((子项目定义) => ({ ...子项目定义, ...检查子项目入口(子项目定义) }));
      const 行列表 = [];

      行列表.push(着色(适配宽度(`请选择要启动的发票自动化子项目（${子项目定义列表.length} 个）：`, 列数), "brightBlue"));
      行列表.push(着色(适配宽度("下载中心：", 列数), "brightCyan"));
      if (ctx.cache.serviceStatus) {
        行列表.push(...构建服务状态行列表(app, ctx.cache.serviceStatus));
      } else if (ctx.cache.downloadCenterSummary) {
        const 摘要 = ctx.cache.downloadCenterSummary;
        const 诺诺状态 = 摘要.诺诺状态 || {};
        行列表.push(`诺诺登录：${着色("●", 诺诺状态.status === "ready" ? "brightGreen" : "brightYellow")} ${着色(诺诺状态.label || "未检查", 诺诺状态.status === "ready" ? "brightGreen" : "brightYellow")}｜发票索引 ${摘要.发票索引数 || 0} 张`);
        行列表.push(着色("下载服务状态将在检查后显示。", "gray"));
      } else {
        行列表.push(着色("下载中心状态检查中…", "brightYellow"));
      }
      行列表.push(着色(适配宽度("平台状态：", 列数), "brightCyan"));

      for (let 索引 = 0; 索引 < 平台状态列表.length; 索引 += 1) {
        const 平台状态 = 平台状态列表[索引];
        行列表.push(构建平台状态行(app, 平台状态, 索引 === 状态.selection));
      }

      行列表.push("");
      const 退出行 = `  [0] 退出控制台`;
      行列表.push(状态.selection >= 平台状态列表.length ? 着色(适配宽度(退出行, 列数), "reverse") : 适配宽度(退出行, 列数));

      if (状态.lastLaunched) {
        行列表.push("");
        行列表.push(着色(`最近启动：${状态.lastLaunched}（${状态.lastLaunchedAt}）`, "brightYellow"));
      }
      if (状态.message) {
        行列表.push(着色(状态.message, "brightYellow"));
      }

      return 行列表;
    },
    footer() {
      return "↑↓选择 回车启动 0退出 1/3-5直接启动 2下载中心页 r刷新状态 Ctrl+C退出";
    },
    handleKey(按键, app) {
      if (按键 === "down") {
        if (状态.selection < 子项目定义列表.length) {
          状态.selection += 1;
        }
        return true;
      }
      if (按键 === "up") {
        if (状态.selection > 0) {
          状态.selection -= 1;
        }
        return true;
      }
      if (按键 === "enter") {
        if (状态.selection === 子项目定义列表.length) {
          ctx.services.requestExit();
          return true;
        }
        启动选中项目(app);
        return true;
      }
      if (按键 === "0") {
        ctx.services.requestExit();
        return true;
      }
      if (按键 === "r" || 按键 === "R") {
        状态.message = "正在刷新下载中心与诺诺登录状态…";
        app.requestRender();
        ctx.services.刷新外部服务状态().finally(() => {
          状态.message = "";
          app.requestRender();
        });
        return true;
      }
        if (按键 === "2") {
          app.切换页面(1);
          return true;
        }
      const 数字 = Number(按键);
      if (Number.isInteger(数字) && 数字 >= 1 && 数字 <= 子项目定义列表.length) {
        // 2 已被上面拦截为切换到下载中心页，避免误启动京东发票回传
        if (数字 === 2) return true;
        启动项目(子项目定义列表[数字 - 1], app);
        return true;
      }
      return false;
    },
  };

  function 启动项目(子项目定义, app) {
    try {
      启动子项目(子项目定义);
      状态.lastLaunched = 子项目定义.项目名称;
      状态.lastLaunchedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      状态.message = `[已启动] ${子项目定义.项目名称} 已在独立窗口打开。`;
    } catch (错误) {
      状态.message = `[失败] ${错误.message}`;
    }
    app.requestRender();
  }

  function 启动选中项目(app) {
    启动项目(子项目定义列表[状态.selection], app);
  }

  function 构建下载中心操作列表() {
    return [
      { id: "open-center", 标签: "打开下载中心控制台", 提示: "在独立窗口检查诺诺登录或管理发票文件" },
      { id: "start-service", 标签: "启动下载中心后台服务", 提示: "服务离线时在后台启动 127.0.0.1:39410，不新增黑窗" },
      { id: "refresh", 标签: "立即刷新登录状态", 提示: "重新读取下载中心服务和诺诺登录状态" },
      { id: "open-dir", 标签: "打开下载目录", 提示: "在资源管理器中打开发票下载文件夹" },
      { id: "exit", 标签: "退出控制台", 提示: "关闭总控制台 TUI 界面", 危险: true },
    ];
  }

  const 下载中心页 = {
    key: "2",
    title: "下载中心",
    state: {
      selection: 0,
    },
    onEnter() {
      this.state.selection = 0;
      刷新下载中心摘要();
      ctx.services.刷新外部服务状态?.();
    },
    render(app) {
      const 列数 = app.columns;
      const 操作列表 = 构建下载中心操作列表();
      const 行列表 = [];
      行列表.push(着色(适配宽度("通用发票下载中心状态：", 列数), "brightCyan"));
      if (ctx.cache.serviceStatus) {
        行列表.push(...构建服务状态行列表(app, ctx.cache.serviceStatus));
      } else {
        行列表.push(着色("状态检查中…", "brightYellow"));
      }

      if (ctx.cache.downloadCenterSummary) {
        const 摘要 = ctx.cache.downloadCenterSummary;
        行列表.push(`本地记录：发票索引 ${摘要.发票索引数 || 0} 张｜诺诺账号${摘要.账号已配置 ? "已配置" : "未配置"}`);
        if (摘要.诺诺状态?.updatedAt) {
          行列表.push(`诺诺状态更新时间：${格式化时间文本(摘要.诺诺状态.updatedAt)}`);
        }
        if (摘要.服务进程) {
          行列表.push(`下载中心服务进程：PID ${摘要.服务进程.pid}`);
        }
      }

      行列表.push("");
      行列表.push(着色("快捷操作（↑↓选择 回车执行）", "brightBlue"));
      for (let 索引 = 0; 索引 < 操作列表.length; 索引 += 1) {
        const 操作 = 操作列表[索引];
        const 选中 = 索引 === this.state.selection;
        const 标记 = 选中 ? "▶ " : "  ";
        const 标签 = 操作.危险 ? 着色(操作.标签, "brightRed") : 操作.标签;
        const 行 = `${标记}${标签}  ${操作.提示 || ""}`;
        行列表.push(选中 ? 着色(适配宽度(行, 列数), "reverse") : 适配宽度(行, 列数));
      }

      if (状态.downloadMessage) {
        行列表.push("");
        行列表.push(着色(`提示：${状态.downloadMessage}`, "brightYellow"));
      }
      return 行列表;
    },
    footer() {
      return "↑↓选择 回车执行 1返回总览 Ctrl+C退出";
    },
    handleKey(按键, app) {
      const 操作列表 = 构建下载中心操作列表();
      if (按键 === "up" || 按键 === "down") {
        const 方向 = 按键 === "down" ? 1 : -1;
        this.state.selection = (this.state.selection + 方向 + 操作列表.length) % 操作列表.length;
        return true;
      }
      if (按键 === "enter") {
        this.执行操作(操作列表[this.state.selection], app);
        return true;
      }
      if (按键 === "0") {
        ctx.services.requestExit();
        return true;
      }
      return false;
    },
    async 执行操作(操作, app) {
      if (!操作) return;
      状态.downloadMessage = "";
      try {
        if (操作.id === "exit") {
          ctx.services.requestExit();
          return;
        }
        if (操作.id === "open-center") {
          ctx.services.打开下载中心();
          状态.downloadMessage = "已在独立窗口打开发票下载中心。";
        } else if (操作.id === "start-service") {
          状态.downloadMessage = "正在后台启动下载中心服务…";
          app.requestRender();
          ctx.services.启动下载中心服务();
          await new Promise((resolve) => setTimeout(resolve, 800));
          await ctx.services.刷新外部服务状态();
          状态.downloadMessage = "下载中心服务启动请求已发送，状态已刷新。";
        } else if (操作.id === "refresh") {
          状态.downloadMessage = "正在刷新下载中心和诺诺登录状态…";
          app.requestRender();
          await ctx.services.刷新外部服务状态();
          状态.downloadMessage = "状态已刷新。";
        } else if (操作.id === "open-dir") {
          const 目录 = await ctx.services.打开下载目录();
          状态.downloadMessage = `已打开下载目录：${目录}`;
        }
      } catch (错误) {
        状态.downloadMessage = 错误 instanceof Error ? 错误.message : String(错误);
      }
      app.requestRender();
    },
  };

  const 页面列表 = [总览页, 下载中心页];
  const app = new TUI应用({
    title: 标题,
    pages: 页面列表,
    output: 选项.output,
    onExitRequest: () => {
      ctx.services.requestExit();
    },
    statusBarProvider: (tuiApp) => {
      const 行列表 = [];
      const 任务状态 = 格式化任务状态(null);
      const 服务状态 = ctx.cache.serviceStatus;
      const 服务文字 = 服务状态?.status === "ready"
        ? `下载中心 ${着色("[可用]", "brightGreen")}`
        : `下载中心 ${着色("[检查中/不可用]", "brightYellow")}`;
      行列表.push(适配宽度(`入口 ${着色(`[${任务状态.标签}]`, 任务状态.颜色)}  ${服务文字}  平台 ${子项目定义列表.length} 个`, tuiApp.columns));
      行列表.push(适配宽度("   总览页回车启动平台控制台；下载中心页可检查诺诺登录并打开下载目录。", tuiApp.columns));
      return 行列表;
    },
  });

  const 默认打开下载中心 = () => 启动下载中心窗口();
  const 默认启动下载中心服务 = () => 启动下载中心服务();
  const 默认打开下载目录 = () => {
    const 总目录 = path.resolve(__dirname, "..");
    return 打开文件夹(path.join(总目录, 下载中心目录名称, "runtime", "downloads"));
  };
  const 默认读取平台状态 = () => 子项目定义列表.map((子项目定义) => ({
    ...子项目定义,
    ...检查子项目入口(子项目定义),
  }));
  const 默认读取下载中心状态 = () => 读取下载中心外部服务状态();
  const 默认读取下载中心摘要 = () => 读取下载中心状态摘要();

  const 读取平台状态 = 选项.读取平台状态 || 默认读取平台状态;
  const 读取下载中心状态 = 选项.读取下载中心状态 || 默认读取下载中心状态;
  const 读取下载中心摘要 = 选项.读取下载中心摘要 || 默认读取下载中心摘要;

  function 刷新平台状态() {
    try {
      ctx.cache.platformStatuses = 读取平台状态();
    } catch {
      // 保留上一次入口状态，单次读取失败不打断 TUI。
    }
  }

  function 刷新下载中心摘要() {
    try {
      ctx.cache.downloadCenterSummary = 读取下载中心摘要();
    } catch {
      // 下载中心摘要读取失败时继续使用旧快照。
    }
  }

  let 服务状态检查中 = false;
  async function 刷新外部服务状态() {
    if (服务状态检查中) return;
    服务状态检查中 = true;
    if (!ctx.cache.serviceStatus) {
        ctx.cache.serviceStatus = { name: "下载中心", status: "checking", label: "检查中" };
      }
    app.requestRender();
    try {
      const 服务状态 = await 读取下载中心状态();
      ctx.cache.serviceStatus = {
        ...服务状态,
        name: "下载中心",
        status: 服务状态?.status || (服务状态?.available ? "ready" : "error"),
        label: 服务状态?.label || (服务状态?.available ? "可用" : "不可用"),
        detail: 服务状态?.detail || "",
      };
    } catch (错误) {
      ctx.cache.serviceStatus = {
        name: "下载中心",
        status: "error",
        label: "不可用",
        detail: String(错误?.message || 错误 || "健康检查失败"),
      };
    } finally {
      服务状态检查中 = false;
      app.requestRender();
    }
  }

  ctx.services = {
    requestExit: () => {
      app.stop();
      清空定时器();
      process.exit(0);
    },
    刷新外部服务状态,
    打开下载中心: 选项.打开下载中心 || 默认打开下载中心,
    启动下载中心服务: 选项.启动下载中心服务 || 默认启动下载中心服务,
    打开下载目录: 选项.打开下载目录 || 默认打开下载目录,
  };

  app.ctx = ctx;
  页面列表.forEach((页面) => {
    页面.ctx = ctx;
  });

  let 定时器列表 = [];
  const 时钟定时器 = setInterval(() => app.requestRender(), 1000);
  const 平台状态定时器 = setInterval(刷新平台状态, 3000);
  const 服务状态定时器 = setInterval(() => { 刷新外部服务状态(); }, 5000);
  定时器列表.push(时钟定时器, 平台状态定时器, 服务状态定时器);
  if (typeof 时钟定时器.unref === "function") 时钟定时器.unref();
  if (typeof 平台状态定时器.unref === "function") 平台状态定时器.unref();
  if (typeof 服务状态定时器.unref === "function") 服务状态定时器.unref();

  function 清空定时器() {
    定时器列表.forEach((定时器) => clearInterval(定时器));
    定时器列表 = [];
  }

  刷新平台状态();
  刷新下载中心摘要();
  刷新外部服务状态();

  return {
    app,
    ctx: app.ctx,
    dispose() {
      清空定时器();
    },
  };
}

if (require.main === module) {
  require("../../共享CLI/最大化控制台窗口").最大化当前控制台窗口();
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
  构建平台状态行,
  构建服务状态行列表,
};
