// 通用发票下载中心 TUI 入口：总览 + 实时日志两个页面，复用共享 TUI 框架。
const path = require("path");
const fs = require("fs");
const { 加载共享框架 } = require("./共享路径");
const { TUI应用 } = 加载共享框架("tuiApp.js");
const { 着色 } = 加载共享框架("ansi.js");
const { 适配宽度 } = 加载共享框架("width.js");
const { 格式化时长毫秒, 格式化任务状态 } = 加载共享框架("format.js");
const { 开始捕获控制台输出 } = 加载共享框架("控制台捕获.js");
const { 创建日志页 } = 加载共享框架("回传平台TUI.js");
const {
  读取发票系统配置,
  构建安全发票系统配置视图,
} = require("../config/invoiceSystemConfig");
const { 验证诺诺登录, 关闭待人工登录会话 } = require("../nuonuo/loginVerifier");
const { 获取下载文件夹路径, 打开下载文件夹 } = require("../server/downloadsFolder");

const 标题 = "通用发票下载中心控制台";

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

function 创建TUI(选项 = {}) {
  const 任务 = 选项.task || 创建初始任务();

  const 日志页 = 创建日志页({ key: "2", title: "日志" });

  const 总览页 = {
    key: "1",
    title: "总览",
    state: {
      selection: 0,
      message: "",
    },
    render(app) {
      const 行列表 = [];
      const 任务状态 = 格式化任务状态(任务);
      let 任务行 = `任务：${着色(`[${任务状态.标签}]`, 任务状态.颜色)}`;
      if (任务?.status === "running" && 任务.startedAt) {
        任务行 += `  已运行 ${格式化时长毫秒(Date.now() - new Date(任务.startedAt).getTime())}`;
      }
      if (任务?.message) {
        任务行 += `  说明：${任务.message}`;
      }
      行列表.push(任务行);

      let 配置摘要 = "未读取";
      try {
        const 安全视图 = 构建安全发票系统配置视图(读取发票系统配置());
        配置摘要 = 安全视图?.summary || 安全视图?.账号 || "已配置";
      } catch (错误) {
        配置摘要 = "读取失败";
      }
      行列表.push(`诺诺账号：${配置摘要}`);

      行列表.push("");
      行列表.push(着色("快捷操作（↑↓选择 回车执行）", "brightBlue"));
      const 操作列表 = [
        { id: "check-login", 标签: "检查诺诺登录", 可用: 任务.status !== "running", 提示: "验证登录态，需要时弹出浏览器" },
        { id: "open-dir", 标签: "打开下载目录", 可用: true, 提示: "在资源管理器中打开发票下载文件夹" },
        { id: "exit", 标签: "退出控制台", 可用: true, 危险: true, 提示: "关闭 TUI 界面" },
      ];
      const 列数 = app.columns;
      for (let 索引 = 0; 索引 < 操作列表.length; 索引 += 1) {
        const 操作 = 操作列表[索引];
        const 选中 = 索引 === this.state.selection;
        const 标记 = 操作.可用 ? (选中 ? "▶ " : "  ") : "  ";
        let 标签 = 操作.标签;
        if (操作.危险) 标签 = 着色(标签, "brightRed");
        if (!操作.可用) 标签 = 着色(标签, "gray");
        const 提示 = 操作.可用 ? `  ${操作.提示 || ""}` : 着色("  （任务进行中，暂不可用）", "gray");
        行列表.push(选中 && 操作.可用 ? 着色(适配宽度(`${标记}${标签}${提示}`, 列数), "reverse") : 适配宽度(`${标记}${标签}${提示}`, 列数));
      }

      if (this.state.message) {
        行列表.push("");
        行列表.push(着色(`提示：${this.state.message}`, "brightYellow"));
      }
      行列表.push("");
      行列表.push(着色("配置、批量下载发票、查看本地发票请使用 CLI 模式：npm run panel:cli", "gray"));

      return 行列表;
    },
    footer() {
      return "1总览 2日志 | ↑↓选择 回车执行 ←→切页 Ctrl+C退出";
    },
    handleKey(按键, app) {
      const 操作列表 = [
        { id: "check-login", 标签: "检查诺诺登录", 可用: 任务.status !== "running" },
        { id: "open-dir", 标签: "打开下载目录", 可用: true },
        { id: "exit", 标签: "退出控制台", 可用: true },
      ];
      if (按键 === "up" || 按键 === "down") {
        const 可用索引列表 = 操作列表.map((操作, 索引) => (操作.可用 ? 索引 : -1)).filter((索引) => 索引 >= 0);
        if (可用索引列表.length === 0) return true;
        const 方向 = 按键 === "down" ? 1 : -1;
        let 当前位置 = 可用索引列表.indexOf(this.state.selection);
        if (当前位置 < 0) 当前位置 = 0;
        当前位置 = (当前位置 + 方向 + 可用索引列表.length) % 可用索引列表.length;
        this.state.selection = 可用索引列表[当前位置];
        return true;
      }
      if (按键 === "enter") {
        const 操作 = 操作列表[this.state.selection];
        if (!操作 || !操作.可用) return true;
        this.执行操作(操作, app);
        return true;
      }
      return false;
    },
    async 执行操作(操作, app) {
      this.state.message = "";
      try {
        if (操作.id === "check-login") {
          await 执行检查登录(app);
          if (任务.status !== "done") {
            throw new Error(任务.message || "诺诺登录检查未通过。");
          }
          this.state.message = "诺诺登录检查通过，结果见「2日志」页。";
        } else if (操作.id === "open-dir") {
          const 目录路径 = 获取下载文件夹路径();
          打开下载文件夹(目录路径);
          this.state.message = `已打开下载目录：${目录路径}`;
        } else if (操作.id === "exit") {
          app.ctx.services.requestExit();
          return;
        }
      } catch (错误) {
        this.state.message = 错误 instanceof Error ? 错误.message : String(错误);
      }
      app.requestRender();
    },
  };

  const 页面列表 = [总览页, 日志页];
  const app = new TUI应用({
    title: 标题,
    pages: 页面列表,
    output: 选项.output,
    onExitRequest: () => {
      app.ctx.services.requestExit();
    },
    statusBarProvider: (tuiApp) => {
      const 任务状态 = 格式化任务状态(任务);
      const 行列表 = [];
      let 第一行 = `任务 ${着色(`[${任务状态.标签}]`, 任务状态.颜色)}`;
      if (任务.status === "running" && 任务.startedAt) {
        第一行 += `  已运行 ${格式化时长毫秒(Date.now() - new Date(任务.startedAt).getTime())}`;
      }
      行列表.push(适配宽度(第一行, tuiApp.columns));
      if (任务.status === "running" && 任务.message) {
        行列表.push(着色(适配宽度(`   ${任务.message}`, tuiApp.columns), "brightYellow"));
      } else {
        行列表.push(适配宽度("   使用说明：数字键或←→切页；任务执行过程实时显示在「2日志」页。", tuiApp.columns));
      }
      return 行列表;
    },
  });
  app.ctx = {
    task: 任务,
    cache: {
      config: { stores: [] },
      serviceStatus: null,
    },
    services: { requestExit: () => { app.stop(); 恢复控制台输出(); 清空定时器(); process.exit(0); } },
  };
  页面列表.forEach((页面) => {
    页面.ctx = app.ctx;
  });

  let 恢复控制台输出 = null;
  let 定时器列表 = [];
  function 清空定时器() {
    定时器列表.forEach((定时器) => clearInterval(定时器));
    定时器列表 = [];
  }

  恢复控制台输出 = 开始捕获控制台输出((行) => {
    日志页.pushLine(行);
    app.requestRender();
  });

  const 时钟定时器 = setInterval(() => app.requestRender(), 1000);
  定时器列表.push(时钟定时器);
  if (typeof 时钟定时器.unref === "function") 时钟定时器.unref();

  async function 执行检查登录(tuiApp) {
    任务.status = "running";
    任务.startedAt = new Date().toISOString();
    任务.message = "正在验证诺诺登录…";
    tuiApp.requestRender();
    try {
      const 结果 = await 验证诺诺登录(读取发票系统配置(), {
        headless: false,
        keepBrowserOpenOnManualLogin: true,
      });
      if (!结果?.ok) {
        任务.status = "error";
        任务.message = 结果?.requiresManualLogin
          ? "浏览器已保持打开，请完成验证码或登录确认后，再次执行“检查诺诺登录”。"
          : `诺诺登录验证失败：${结果?.message || "真实登录校验未通过"}`;
        throw new Error(任务.message);
      }
      任务.status = "done";
      任务.message = "诺诺登录验证完成，真实发票接口可用。";
    } catch (错误) {
      任务.status = "error";
      if (!任务.message || 任务.message === "正在验证诺诺登录…") {
        任务.message = `诺诺登录验证失败：${错误.message}`;
      }
    } finally {
      任务.finishedAt = new Date().toISOString();
      tuiApp.requestRender();
    }
  }

  return {
    app,
    ctx: app.ctx,
    dispose() {
      恢复控制台输出();
      清空定时器();
    },
  };
}

if (require.main === module) {
  require("../../../../共享CLI/最大化控制台窗口").最大化当前控制台窗口();
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
};
