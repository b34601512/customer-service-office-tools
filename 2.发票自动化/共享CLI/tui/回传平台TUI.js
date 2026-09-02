// 回传平台 TUI 模板：供天猫/拼多多/抖音等“多店铺 + 登录 + 发票回传”平台共用。
// 页面只消费 ctx.cache 的快照数据，服务动作统一走 ctx.services，日志实时进日志页。
const { TUI应用 } = require("./tuiApp");
const { 着色 } = require("./ansi");
const { 适配宽度 } = require("./width");
const { 格式化时长毫秒, 格式化任务状态, 格式化时间文本 } = require("./format");
const { 开始捕获控制台输出 } = require("./控制台捕获");
const { 判断诺诺登录就绪 } = require("../启动下载中心");
const {
  构建表头,
  构建表格行,
  计算表格宽度方案,
  构建订单镜像列表,
  过滤订单镜像列表,
  切换订单过滤模式,
  订单过滤模式,
  构建订单表格宽度方案,
  构建订单表格头,
  构建订单表格行,
  渲染订单详情,
} = require("./镜像表格");

const 日志行数上限 = 3000;

const 总览店铺表格列定义 = [
  { 标题: "店铺", 宽度: 14 },
  { 标题: "待处理", 宽度: 6 },
  { 标题: "处理中", 宽度: 6 },
  { 标题: "已登记", 宽度: 6 },
  { 标题: "已处理", 宽度: 6 },
  { 标题: "最近结果", 宽度: "flex" },
];

function 提取日志时间(行) {
  const 匹配结果 = String(行 || "").match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  return 匹配结果 ? 匹配结果[1] : "";
}

function 解析日志店铺结果(行) {
  const 匹配结果 = String(行 || "").match(/\[店铺\]\s*([^｜]+)｜(success|partial|skipped|error)｜成功\s*(\d+)\/(\d+)｜跳过\s*(\d+)｜失败\s*(\d+)/i);
  if (!匹配结果) return null;
  return {
    name: 匹配结果[1].trim(),
    status: 匹配结果[2].toLowerCase(),
    success: Number(匹配结果[3]),
    total: Number(匹配结果[4]),
    skipped: Number(匹配结果[5]),
    error: Number(匹配结果[6]),
  };
}

function 创建日志任务总览() {
  return {
    stores: new Map(),
    lastError: "",
  };
}

function 更新日志任务总览(总览, 行) {
  const 店铺结果 = 解析日志店铺结果(行);
  if (店铺结果) {
    总览.stores.set(店铺结果.name, 店铺结果);
  }
  const 文本 = String(行 || "");
  if (/下载失败|回传失败|登录态已失效|失败[:：]|｜error｜/i.test(文本)) {
    总览.lastError = 文本.replace(/^\[[^\]]+\]\s*/, "").trim();
  }
}

function 创建日志页(选项 = {}) {
  const 页面 = {
    key: String(选项.key || "3"),
    title: String(选项.title || "日志"),
    state: {
      lines: [],
      scrollOffset: 0,
      follow: true,
      filterActive: false,
      filterBuffer: "",
      filterText: "",
      summary: 创建日志任务总览(),
    },
    pushLine(行) {
      const 文本 = String(行 || "");
      this.state.lines.push(文本);
      更新日志任务总览(this.state.summary, 文本);
      if (this.state.lines.length > 日志行数上限) {
        this.state.lines.splice(0, this.state.lines.length - 日志行数上限);
      }
      if (this.state.follow && !this.state.filterActive) {
        this.state.scrollOffset = 0;
      }
    },
    构建任务总览行(app) {
      const 任务 = app.ctx.task || {};
      const 结果列表 = [...this.state.summary.stores.values()];
      const 店铺总数 = 结果列表.length || (app.ctx.cache.config?.stores || []).length;
      const 成功店铺 = 结果列表.filter((item) => item.status === "success").length;
      const 跳过店铺 = 结果列表.filter((item) => item.status === "skipped").length;
      const 失败店铺 = 结果列表.filter((item) => item.status === "error").length;
      const 部分店铺 = 结果列表.filter((item) => item.status === "partial").length;
      const 成功发票 = 结果列表.reduce((sum, item) => sum + item.success, 0);
      const 跳过发票 = 结果列表.reduce((sum, item) => sum + item.skipped, 0);
      const 失败发票 = 结果列表.reduce((sum, item) => sum + item.error, 0);
      const 行列表 = [
        着色(适配宽度("本次任务总览", app.columns), "brightCyan"),
        `状态：${格式化任务状态(任务).标签}｜店铺 ${店铺总数} 家｜成功 ${成功店铺}｜部分成功 ${部分店铺}｜跳过 ${跳过店铺}｜失败 ${失败店铺}`,
        `发票：成功 ${成功发票}｜跳过 ${跳过发票}｜失败 ${失败发票}`,
      ];
      if (this.state.summary.lastError) {
        行列表.push(着色(适配宽度(`最近问题：${this.state.summary.lastError}`, app.columns), "brightRed"));
      }
      行列表.push(着色(适配宽度("详细日志（可滚动）", app.columns), "brightBlue"));
      return 行列表;
    },
    onEnter() {
      this.state.filterActive = false;
      if (this.state.follow) {
        this.state.scrollOffset = 0;
      }
    },
    获取可见行() {
      const 过滤文字 = this.state.filterText.trim().toLowerCase();
      return 过滤文字
        ? this.state.lines.filter((行) => String(行).toLowerCase().includes(过滤文字))
        : this.state.lines;
    },
    render(app) {
      const 列数 = app.columns;
      const 内容高度 = app.contentHeight;
      const 总览行 = this.构建任务总览行(app);
      const 日志内容高度 = Math.max(1, 内容高度 - 总览行.length - 1);
      const 可见行 = this.获取可见行();

      if (this.state.follow) {
        this.state.scrollOffset = 0;
      }
      const 最大偏移 = Math.max(0, 可见行.length - 日志内容高度);
      if (this.state.scrollOffset > 最大偏移) {
        this.state.scrollOffset = 最大偏移;
      }

      const 行列表 = [...总览行, ""];
      const 过滤文字 = this.state.filterText.trim();
      行列表.push(着色(
        适配宽度(`日志（${可见行.length} 条${过滤文字 ? `，过滤“${过滤文字}”` : ""}${this.state.follow ? "，跟随最新" : ""}）`, 列数),
        "brightBlue"
      ));

      if (可见行.length === 0) {
        行列表.push(着色("暂无日志。启动任务后，执行过程会实时显示在这里。", "gray"));
        return 行列表;
      }

      const 起始索引 = Math.max(0, 可见行.length - this.state.scrollOffset - 日志内容高度);
      const 结束索引 = 可见行.length - this.state.scrollOffset;
      for (let 索引 = 起始索引; 索引 < 结束索引; 索引 += 1) {
        const 原始行 = 可见行[索引] || "";
        const 时间文本 = 提取日志时间(原始行);
        const 时间宽度 = 时间文本 ? 时间文本.length + 1 : 0;
        const 正文 = 时间文本 ? 原始行.slice(时间文本.length + 1) : 原始行;
        const 彩色正文 = 正文.includes("主线:失败")
          ? 着色(适配宽度(正文, 列数 - 时间宽度), "brightRed")
          : 正文.includes("主线:提醒")
            ? 着色(适配宽度(正文, 列数 - 时间宽度), "brightYellow")
            : 适配宽度(正文, 列数 - 时间宽度);
        行列表.push(`${时间文本 ? 适配宽度(时间文本, 时间宽度) : ""}${彩色正文}`);
      }
      return 行列表;
    },
    footer() {
      const 过滤提示 = this.state.filterActive ? "输入过滤关键字，回车应用，Esc 取消" : "↑↓滚动 PgUp/PgDn翻页 /过滤 f跟随/停止 r清屏 ←→切页 q返回总览";
      return 过滤提示;
    },
    handleKey(按键, app) {
      if (this.state.filterActive) {
        if (按键 === "enter") {
          this.state.filterText = this.state.filterBuffer;
          this.state.filterActive = false;
          this.state.follow = true;
          this.state.scrollOffset = 0;
          return true;
        }
        if (按键 === "esc") {
          this.state.filterActive = false;
          this.state.filterBuffer = "";
          return true;
        }
        if (按键 === "backspace") {
          this.state.filterBuffer = this.state.filterBuffer.slice(0, -1);
          return true;
        }
        if (typeof 按键 === "string" && 按键.length === 1 && 按键 >= " " && 按键 !== "\x7f") {
          this.state.filterBuffer += 按键;
          return true;
        }
        return true;
      }

      const 可见行 = this.获取可见行();
      const 内容高度 = app.contentHeight;
      const 最大偏移 = Math.max(0, 可见行.length - 内容高度);

      if (按键 === "/") {
        this.state.filterActive = true;
        this.state.filterBuffer = "";
        return true;
      }
      if (按键 === "f") {
        this.state.follow = !this.state.follow;
        if (this.state.follow) {
          this.state.scrollOffset = 0;
        }
        return true;
      }
      if (按键 === "r") {
        this.state.lines = [];
        return true;
      }
      if (按键 === "up") {
        this.state.follow = false;
        this.state.scrollOffset = Math.min(最大偏移, this.state.scrollOffset + 1);
        return true;
      }
      if (按键 === "down") {
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
        if (this.state.scrollOffset === 0) {
          this.state.follow = true;
        }
        return true;
      }
      if (按键 === "pgup") {
        this.state.follow = false;
        this.state.scrollOffset = Math.min(最大偏移, this.state.scrollOffset + 内容高度);
        return true;
      }
      if (按键 === "pgdn") {
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 内容高度);
        if (this.state.scrollOffset === 0) {
          this.state.follow = true;
        }
        return true;
      }
      if (按键 === "home") {
        this.state.follow = false;
        this.state.scrollOffset = 最大偏移;
        return true;
      }
      if (按键 === "end") {
        this.state.scrollOffset = 0;
        this.state.follow = true;
        return true;
      }
      return false;
    },
  };

  return 页面;
}

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

function 脱敏账号(账号) {
  const 标准账号 = String(账号 || "").trim();
  if (!标准账号) {
    return "未配置";
  }
  if (标准账号.length <= 3) {
    return `${标准账号.slice(0, 1)}***`;
  }
  return `${标准账号.slice(0, 3)}***${标准账号.slice(-2)}`;
}

function 创建总览页(模板选项) {
  let 总览订单缓存 = { 时间: 0, 列表: null };
  function 读取总览订单镜像列表() {
    if (typeof 模板选项.读取全部订单 !== "function") return null;
    const 当前时间 = Date.now();
    if (总览订单缓存.列表 && 当前时间 - 总览订单缓存.时间 < 2000) {
      return 总览订单缓存.列表;
    }
    try {
      总览订单缓存 = { 时间: 当前时间, 列表: 构建订单镜像列表(模板选项.读取全部订单() || []) };
    } catch {
      总览订单缓存 = { 时间: 当前时间, 列表: [] };
    }
    return 总览订单缓存.列表;
  }
  const 页面 = {
    key: "1",
    title: "总览",
    state: {
      selection: 0,
      message: "",
    },
    构建快捷操作(上下文) {
      const 任务 = 上下文.task;
      const 运行中 = Boolean(任务 && 任务.status === "running");
      const 操作列表 = [];
      for (const 操作定义 of 模板选项.快捷操作 || []) {
        操作列表.push({ ...操作定义, 可用: 操作定义.可用 === false ? false : !运行中 });
      }
      if (typeof 模板选项.打开下载中心 === "function") {
        const 下载中心操作 = {
          id: "download-center",
          标签: "发票下载中心",
          可用: !运行中,
          提示: "打开下载中心，检查诺诺登录或管理发票文件",
        };
        // 未登录时把下载中心顶到第一位；登录后沉到底部，只保留在退出之前。
        if (判断诺诺登录就绪(上下文?.cache?.serviceStatus)) {
          操作列表.push(下载中心操作);
        } else {
          操作列表.unshift(下载中心操作);
        }
      }
      操作列表.push({
        id: "refresh-status",
        标签: "刷新下载中心状态",
        可用: !运行中,
        提示: "立即重新检查诺诺登录与下载服务",
      });
      操作列表.push({ id: "exit", 标签: "退出控制台", 可用: true, 危险: true, 提示: "关闭 TUI 界面" });
      return 操作列表;
    },
    onEnter() {
      const 操作列表 = this.构建快捷操作(this.ctx);
      const 可用索引列表 = 操作列表.map((操作, 索引) => (操作.可用 ? 索引 : -1)).filter((索引) => 索引 >= 0);
      if (可用索引列表.length > 0 && !可用索引列表.includes(this.state.selection)) {
        this.state.selection = 可用索引列表[0];
      }
        // 每次回到总览页立即刷新下载中心状态，不等轮询周期。
        if (typeof this.ctx?.services?.刷新外部服务状态 === "function") {
          this.ctx.services.刷新外部服务状态();
        }
    },
    render(app) {
      const 上下文 = app.ctx;
      const 任务 = 上下文.task;
      const 配置 = 上下文.cache.config || { stores: [] };
      const 店铺列表 = Array.isArray(配置.stores) ? 配置.stores : [];
      const 启用店铺 = 店铺列表.filter((店铺) => 店铺.enabled !== false);
      const 操作列表 = this.构建快捷操作(上下文);

      const 行列表 = [];
      const 任务状态 = 格式化任务状态(任务);
      let 任务行 = `任务：${着色(`[${任务状态.标签}]`, 任务状态.颜色)}`;
      if (任务?.currentStore) {
        任务行 += `  当前店铺：${任务.currentStore}`;
      }
      if (任务?.status === "running" && 任务.startedAt) {
        任务行 += `  已运行 ${格式化时长毫秒(Date.now() - new Date(任务.startedAt).getTime())}`;
      }
      if (任务?.message) {
        任务行 += `  说明：${任务.message}`;
      }
      行列表.push(任务行);

      行列表.push(`店铺：共 ${店铺列表.length} 家｜启用 ${着色(String(启用店铺.length), 启用店铺.length > 0 ? "brightGreen" : "gray")}`);

      const 状态附加行 = 模板选项.总览附加行 ? 模板选项.总览附加行(上下文) : null;
      if (状态附加行) {
        行列表.push(...状态附加行);
      }

      const 服务状态 = 上下文.cache.serviceStatus;
      if (服务状态) {
        const 状态列表 = Array.isArray(服务状态.items) && 服务状态.items.length > 0
          ? 服务状态.items
          : [服务状态];
        for (const 单项状态 of 状态列表) {
          const 状态 = String(单项状态.status || "checking");
          const 颜色 = 状态 === "ready" ? "brightGreen" : (状态 === "checking" ? "brightYellow" : "brightRed");
          const 名称 = String(单项状态.name || 服务状态.name || "外部服务");
          const 标签 = String(单项状态.label || (状态 === "ready" ? "可用" : 状态 === "checking" ? "检查中" : "失效"));
          const 详情 = 单项状态.detail ? `｜${单项状态.detail}` : "";
          行列表.push(`${名称}：${着色("●", 颜色)} ${着色(标签, 颜色)}${详情}`);
        }
      }

        if (typeof 模板选项.读取店铺订单 === "function") {
          行列表.push("");
          行列表.push(着色("店铺订单一览", "brightBlue"));
          行列表.push(构建表头(总览店铺表格列定义, app.columns));
          const 预览店铺列表 = 店铺列表.slice(0, 5);
            const 全部订单镜像列表 = 读取总览订单镜像列表();
          for (let 索引 = 0; 索引 < 预览店铺列表.length; 索引 += 1) {
            const 店铺 = 预览店铺列表[索引];
            let 订单镜像列表 = [];
            try {
              订单镜像列表 = Array.isArray(全部订单镜像列表)
                  ? 全部订单镜像列表.filter((镜像) => String(镜像.storeId || "") === String(店铺.id || ""))
                  : 构建订单镜像列表(模板选项.读取店铺订单(店铺) || []);
            } catch {
              订单镜像列表 = [];
            }
            const 统计 = { 待处理: 0, 处理中: 0, 已登记: 0, 已处理: 0 };
            for (const 镜像 of 订单镜像列表) {
              if (镜像.workflowStatus === "pending") 统计.待处理 += 1;
              else if (镜像.workflowStatus === "processing") 统计.处理中 += 1;
              else if (镜像.workflowStatus === "invoice_registered") 统计.已登记 += 1;
              else if (镜像.workflowStatus === "handled") 统计.已处理 += 1;
            }
            const 最近结果 = typeof 模板选项.格式化结果 === "function" ? String(模板选项.格式化结果(店铺) || "暂无结果") : "暂无结果";
            const 结果颜色 = /失败|失效|错误/.test(最近结果) ? "brightRed" : (最近结果 === "暂无结果" ? "gray" : "brightGreen");
            行列表.push(构建表格行(总览店铺表格列定义, [
              { 文本: 店铺.name || "未命名" },
              { 文本: String(统计.待处理), 颜色: 统计.待处理 > 0 ? "yellow" : "" },
              { 文本: String(统计.处理中), 颜色: 统计.处理中 > 0 ? "brightYellow" : "" },
              { 文本: String(统计.已登记), 颜色: 统计.已登记 > 0 ? "brightCyan" : "" },
              { 文本: String(统计.已处理), 颜色: 统计.已处理 > 0 ? "brightGreen" : "" },
              { 文本: 最近结果, 颜色: 结果颜色 },
            ], app.columns));
          }
          if (店铺列表.length > 预览店铺列表.length) {
            行列表.push(着色(适配宽度(`其余 ${店铺列表.length - 预览店铺列表.length} 家请到「2店铺」页查看。`, app.columns), "gray"));
          }
        }

      行列表.push("");
      行列表.push(着色("快捷操作（↑↓选择 回车执行）", "brightBlue"));
      const 列数 = app.columns;
      for (let 索引 = 0; 索引 < 操作列表.length; 索引 += 1) {
        const 操作 = 操作列表[索引];
        const 选中 = 索引 === this.state.selection;
        const 标记 = 操作.可用 ? (选中 ? "▶ " : "  ") : "  ";
        let 标签 = 操作.标签;
        if (操作.可用 && 操作.危险) {
          标签 = 着色(标签, "brightRed");
        } else if (操作.可用 && 操作.紧急) {
          标签 = 着色(标签, "brightYellow");
        } else if (!操作.可用) {
          标签 = 着色(标签, "gray");
        }
        const 提示 = 操作.可用 ? `  ${操作.提示 || ""}` : 着色("  （任务进行中，暂不可用）", "gray");
        const 行 = `${标记}${标签}${提示}`;
        行列表.push(选中 && 操作.可用 ? 着色(适配宽度(行, 列数), "reverse") : 适配宽度(行, 列数));
      }

      if (this.state.message) {
        行列表.push("");
        行列表.push(着色(`提示：${this.state.message}`, "brightYellow"));
      }

      return 行列表;
    },
    footer() {
      return "↑↓选择 回车执行 ←→切页 Ctrl+C退出";
    },
    handleKey(按键, app) {
      const 操作列表 = this.构建快捷操作(app.ctx);
      if (按键 === "up" || 按键 === "down") {
        const 可用索引列表 = 操作列表.map((操作, 索引) => (操作.可用 ? 索引 : -1)).filter((索引) => 索引 >= 0);
        if (可用索引列表.length === 0) {
          return true;
        }
        const 方向 = 按键 === "down" ? 1 : -1;
        let 当前位置 = 可用索引列表.indexOf(this.state.selection);
        if (当前位置 < 0) {
          当前位置 = 0;
        }
        当前位置 = (当前位置 + 方向 + 可用索引列表.length) % 可用索引列表.length;
        this.state.selection = 可用索引列表[当前位置];
        return true;
      }

      if (按键 === "enter") {
        const 操作 = 操作列表[this.state.selection];
        if (!操作 || !操作.可用) {
          return true;
        }
        this.执行操作(操作, app);
        return true;
      }

      return false;
    },
    async 执行操作(操作, app) {
      const 上下文 = app.ctx;
      this.state.message = "";
      try {
        const 动作函数 = 模板选项.操作动作?.[操作.id];
        if (操作.id === "exit") {
          上下文.services.requestExit();
          return;
        }
        if (操作.id === "download-center") {
          模板选项.打开下载中心();
          this.state.message = "已在独立窗口打开发票下载中心，正在刷新诺诺登录状态…";
          app.requestRender();
          if (typeof 上下文.services.刷新外部服务状态 === "function") {
            await 上下文.services.刷新外部服务状态();
          }
          const 诺诺条目 = Array.isArray(上下文.cache.serviceStatus?.items)
            ? 上下文.cache.serviceStatus.items.find((条目) => String(条目?.name || "").includes("诺诺登录"))
            : null;
          this.state.message = 诺诺条目?.status === "ready"
            ? "下载中心已打开，诺诺登录可用。"
            : "下载中心已打开，诺诺登录状态见顶部提示；如仍显示未检查，请到下载中心执行“检查诺诺登录”。";
          app.requestRender();
          return;
        }
        if (操作.id === "refresh-status") {
          // 解决：登录态可能已变化但页面仍显示旧快照，手动刷新立即重新探测诺诺登录与下载服务。
          this.state.message = "正在刷新下载中心与诺诺登录状态…";
          app.requestRender();
          if (typeof 上下文.services.刷新外部服务状态 === "function") {
            await 上下文.services.刷新外部服务状态();
          }
          this.state.message = "下载中心状态已刷新。";
          app.requestRender();
          return;
        }
        if (typeof 动作函数 === "function") {
          await 动作函数(上下文);
          this.state.message = 操作.完成提示 || "操作已完成。";
        } else {
          this.state.message = "该操作未配置。";
        }
      } catch (错误) {
        this.state.message = 错误 instanceof Error ? 错误.message : String(错误);
      }
      app.requestRender();
    },
  };

  return 页面;
}

function 创建店铺页(模板选项) {
  const 店铺表格列定义 = [
    { 标题: "#", 宽度: 4, 最小宽度: 3, 最大宽度: 4 },
    { 标题: "店铺", 宽度: 14, 最小宽度: 8, 最大宽度: 24 },
    { 标题: "登录", 宽度: 10, 最小宽度: 8, 最大宽度: 16 },
    { 标题: "待处理", 宽度: 6, 最小宽度: 4, 最大宽度: 8 },
    { 标题: "处理中", 宽度: 6, 最小宽度: 4, 最大宽度: 8 },
    { 标题: "已登记", 宽度: 6, 最小宽度: 4, 最大宽度: 8 },
    { 标题: "已处理", 宽度: 6, 最小宽度: 4, 最大宽度: 8 },
    { 标题: "最近结果", 宽度: "flex", 最小宽度: 12 },
  ];

  function 读取店铺订单(店铺) {
    if (typeof 模板选项.读取店铺订单 !== "function") return null;
    try {
      return 模板选项.读取店铺订单(店铺) || [];
    } catch {
      return [];
    }
  }

    let 全部订单缓存 = { 时间: 0, 列表: null };
    function 读取全部订单镜像列表() {
      if (typeof 模板选项.读取全部订单 !== "function") return null;
      const 当前时间 = Date.now();
      if (全部订单缓存.列表 && 当前时间 - 全部订单缓存.时间 < 2000) {
        return 全部订单缓存.列表;
      }
      try {
        全部订单缓存 = { 时间: 当前时间, 列表: 构建订单镜像列表(模板选项.读取全部订单() || []) };
      } catch {
        全部订单缓存 = { 时间: 当前时间, 列表: [] };
      }
      return 全部订单缓存.列表;
    }

    function 读取店铺订单镜像列表(店铺) {
      const 全部列表 = 读取全部订单镜像列表();
      if (Array.isArray(全部列表)) {
        return 全部列表.filter((镜像) => String(镜像.storeId || "") === String(店铺.id || ""));
      }
      const 订单列表 = 读取店铺订单(店铺);
      return Array.isArray(订单列表) ? 构建订单镜像列表(订单列表) : [];
    }

  function 构建店铺订单镜像(店铺) {
      if (typeof 模板选项.读取全部订单 === "function") {
        const 镜像列表 = 读取店铺订单镜像列表(店铺);
        const 统计 = { 待处理: 0, 处理中: 0, 已登记: 0, 已处理: 0 };
        for (const 镜像 of 镜像列表) {
          if (镜像.workflowStatus === "pending") 统计.待处理 += 1;
          else if (镜像.workflowStatus === "processing") 统计.处理中 += 1;
          else if (镜像.workflowStatus === "invoice_registered") 统计.已登记 += 1;
          else if (镜像.workflowStatus === "handled") 统计.已处理 += 1;
        }
        return { 镜像列表, 统计 };
      }
    const 订单列表 = 读取店铺订单(店铺);
    if (!Array.isArray(订单列表)) return { 镜像列表: [], 统计: null };
    const 镜像列表 = 构建订单镜像列表(订单列表);
    const 统计 = { 待处理: 0, 处理中: 0, 已登记: 0, 已处理: 0 };
    for (const 镜像 of 镜像列表) {
      if (镜像.workflowStatus === "pending") 统计.待处理 += 1;
      else if (镜像.workflowStatus === "processing") 统计.处理中 += 1;
      else if (镜像.workflowStatus === "invoice_registered") 统计.已登记 += 1;
      else if (镜像.workflowStatus === "handled") 统计.已处理 += 1;
    }
    return { 镜像列表, 统计 };
  }

  function 读取最近结果(店铺) {
    if (typeof 模板选项.格式化结果 !== "function") return { 文本: "暂无结果记录", 颜色: "gray" };
    const 文本 = 模板选项.格式化结果(店铺);
    if (!文本) return { 文本: "尚无结果记录", 颜色: "gray" };
    if (/失败|失效|错误/.test(String(文本))) return { 文本, 颜色: "brightRed" };
    return { 文本, 颜色: "brightGreen" };
  }

  function 构建店铺表头(列数, 宽度方案 = null) {
    return 构建表头(店铺表格列定义, 列数, 宽度方案);
  }

  function 构建店铺表格值列表(索引, 店铺) {
    const 登录状态 = 模板选项.读取登录状态 ? 模板选项.读取登录状态(店铺) : null;
    const 登录就绪 = 登录状态?.status === "ready";
    const 订单数据 = 构建店铺订单镜像(店铺);
    const 统计 = 订单数据.统计;
    const 最近结果 = 读取最近结果(店铺);
    const 启用文字 = 店铺.enabled === false ? "停用" : "启用";
    return [
      { 文本: String(索引 + 1), 颜色: "gray" },
      { 文本: `${店铺.name || "未命名"}` },
      {
        文本: 登录就绪 ? (登录状态.标签 || "已就绪") : (登录状态?.标签 || "未检查"),
        颜色: 登录就绪 ? "brightGreen" : "yellow",
      },
      { 文本: String(统计 ? 统计.待处理 : "-"), 颜色: 统计?.待处理 > 0 ? "yellow" : "" },
      { 文本: String(统计 ? 统计.处理中 : "-"), 颜色: 统计?.处理中 > 0 ? "brightYellow" : "" },
      { 文本: String(统计 ? 统计.已登记 : "-"), 颜色: 统计?.已登记 > 0 ? "brightCyan" : "" },
      { 文本: String(统计 ? 统计.已处理 : "-"), 颜色: 统计?.已处理 > 0 ? "brightGreen" : "" },
      { 文本: `${启用文字}｜${最近结果.文本}`, 颜色: 最近结果.颜色 || "" },
    ];
  }

  function 构建店铺表格行(索引, 店铺, 列数, 宽度方案 = null, 值列表 = null) {
    return 构建表格行(
      店铺表格列定义,
      值列表 || 构建店铺表格值列表(索引, 店铺),
      列数,
      宽度方案,
    );
  }

  function 渲染店铺订单明细(app, 店铺) {
    const 上下文 = app.ctx;
    const 列数 = app.columns;
    const 内容高度 = app.contentHeight;
    const 镜像列表 = 构建店铺订单镜像(店铺).镜像列表;
    const 过滤模式 = 订单过滤模式[this.state.detailFilterMode] || 订单过滤模式[0];
    const 可见列表 = 过滤订单镜像列表(镜像列表, this.state.detailFilterMode);
    const 宽度方案 = 构建订单表格宽度方案(列数, [], 可见列表);
    const 最大偏移 = Math.max(0, 可见列表.length - Math.max(1, 内容高度 - 3));
    if (this.state.detailScroll > 最大偏移) this.state.detailScroll = 最大偏移;
    const 行列表 = [];
    行列表.push(着色(适配宽度(`店铺订单明细：${店铺.name || "未命名"}`, 列数), "brightCyan"));
    行列表.push(着色(
      适配宽度(`（过滤:${过滤模式.label}，显示 ${可见列表.length}/${镜像列表.length} 单，f 切换）`, 列数),
      "gray"
    ));
    行列表.push(构建订单表格头(列数, [], 宽度方案));
    if (可见列表.length === 0) {
      行列表.push(着色("该店暂无同步到的订单明细。", "gray"));
      return 行列表;
    }
    const 起始索引 = this.state.detailScroll;
    const 结束索引 = Math.min(可见列表.length, 起始索引 + Math.max(1, 内容高度 - 4));
    for (let 索引 = 起始索引; 索引 < 结束索引; 索引 += 1) {
      const 行 = 构建订单表格行(索引, 可见列表[索引], 列数, [], 宽度方案);
      行列表.push(索引 === this.state.detailSelectedIndex ? 着色(适配宽度(行, 列数), "reverse") : 适配宽度(行, 列数));
    }
    if (this.state.detailMessage) {
      行列表.push(着色(`提示：${适配宽度(this.state.detailMessage, Math.max(1, 列数 - 4))}`, "brightYellow"));
    }
    return 行列表;
  }

  const 页面 = {
    key: "2",
    title: "店铺",
    state: {
      selection: 0,
      scrollOffset: 0,
      detailStore: null,
      detailItems: [],
      detailScroll: 0,
      detailFilterMode: 0,
      detailSelectedIndex: 0,
      detailMessage: "",
    },
    onEnter() {
      const 店铺列表 = this.ctx.cache.config?.stores || [];
      this.state.detailStore = null;
      this.state.detailMessage = "";
      if (this.state.selection >= 店铺列表.length) {
        this.state.selection = Math.max(0, 店铺列表.length - 1);
      }
    },
    render(app) {
      const 上下文 = app.ctx;
      const 店铺列表 = Array.isArray(上下文.cache.config?.stores) ? 上下文.cache.config.stores : [];
      const 列数 = app.columns;
      const 内容高度 = app.contentHeight;

      if (this.state.detailStore) {
        return 渲染店铺订单明细.call(this, app, this.state.detailStore);
      }

      const 支持订单明细 = typeof 模板选项.读取店铺订单 === "function";
      const 行列表 = [];
      if (支持订单明细) {
        行列表.push(着色(适配宽度(`店铺列表（共 ${店铺列表.length} 家，↑↓选择，回车查看订单明细）`, 列数), "brightBlue"));
      } else {
        行列表.push(着色(适配宽度(`店铺列表（共 ${店铺列表.length} 家，↑↓ 浏览）`, 列数), "brightBlue"));
      }
      if (店铺列表.length === 0) {
        行列表.push(着色("当前没有店铺配置。", "gray"));
        return 行列表;
      }

      if (!支持订单明细) {
        const 每店行数 = 2;
        const 可见店数 = Math.max(1, Math.floor(内容高度 / 每店行数) - 1);
        const 最大偏移 = Math.max(0, 店铺列表.length - 可见店数);
        if (this.state.scrollOffset > 最大偏移) {
          this.state.scrollOffset = 最大偏移;
        }
        for (let 索引 = this.state.scrollOffset; 索引 < 店铺列表.length && 索引 < this.state.scrollOffset + 可见店数; 索引 += 1) {
          const 店铺 = 店铺列表[索引];
          const 选中 = 索引 === this.state.selection;
          const 启用文字 = 店铺.enabled === false ? 着色("停用", "gray") : 着色("启用", "brightGreen");
          const 登录状态 = 模板选项.读取登录状态 ? 模板选项.读取登录状态(店铺) : null;
          const 登录文字 = 登录状态?.status === "ready" ? 着色(登录状态.标签 || "已就绪", "brightGreen") : 着色(登录状态?.标签 || "未检查", "yellow");
          const 账号文字 = 脱敏账号(店铺.username || 店铺.phoneNumber || "");
          const 结果行 = 模板选项.格式化结果 ? 模板选项.格式化结果(店铺) : "";
          const 第一行 = `  [${索引 + 1}] ${店铺.name || "未命名"} (${店铺.id || "-"})｜${启用文字}｜登录：${登录文字}｜账号：${账号文字}`;
          行列表.push(选中 ? 着色(适配宽度(第一行, 列数), "reverse") : 适配宽度(第一行, 列数));
          行列表.push(适配宽度(结果行 ? `      最近结果：${结果行}` : "      尚无结果记录", 列数));
        }
        if (店铺列表.length > 可见店数) {
          行列表.push(着色(`第 ${this.state.scrollOffset + 1}-${Math.min(店铺列表.length, this.state.scrollOffset + 可见店数)}/${店铺列表.length} 家｜↑↓ 浏览`, "gray"));
        }
        return 行列表;
      }

      const 可见店数 = Math.max(1, 内容高度 - 3);
      const 最大偏移 = Math.max(0, 店铺列表.length - 可见店数);
      if (this.state.scrollOffset > 最大偏移) {
        this.state.scrollOffset = 最大偏移;
      }
      const 结束索引 = Math.min(店铺列表.length, this.state.scrollOffset + 可见店数);
      const 可见行记录列表 = [];
      for (let 索引 = this.state.scrollOffset; 索引 < 结束索引; 索引 += 1) {
        const 店铺 = 店铺列表[索引];
        可见行记录列表.push({
          索引,
          店铺,
          值列表: 构建店铺表格值列表(索引, 店铺),
        });
      }
      const 宽度方案 = 计算表格宽度方案(
        店铺表格列定义,
        可见行记录列表.map((记录) => 记录.值列表),
        列数,
      );
      行列表.push(构建店铺表头(列数, 宽度方案));
      for (const 记录 of 可见行记录列表) {
        const 行 = 构建店铺表格行(记录.索引, 记录.店铺, 列数, 宽度方案, 记录.值列表);
        行列表.push(记录.索引 === this.state.selection ? 着色(适配宽度(行, 列数), "reverse") : 适配宽度(行, 列数));
      }
      if (店铺列表.length > 可见店数) {
        行列表.push(着色(适配宽度(`第 ${this.state.scrollOffset + 1}-${结束索引}/${店铺列表.length} 家｜↑↓ 滚动`, 列数), "gray"));
      }
      return 行列表;
    },
    footer() {
      if (this.state.detailStore) {
        const 标记提示 = typeof 模板选项.订单页标记已安排 === "function" ? " a标记已安排" : "";
        return `f切换过滤 r刷新 Home/End首尾 ↑↓滚动${标记提示} 回车/Esc返回店铺列表 q返回总览`;
      }
      if (typeof 模板选项.读取店铺订单 === "function") {
        const 附加 = 模板选项.店铺页操作提示 || "";
        const 标记提示 = typeof 模板选项.订单页标记已安排 === "function" ? " a明细标记已安排" : "";
        return `↑↓选择 回车订单明细${附加}${标记提示} ←→切页 q返回总览`;
      }
      const 附加 = 模板选项.店铺页操作提示 || "";
      return `↑↓浏览${附加} ←→切页 q返回总览`;
    },
    handleKey(按键, app) {
      const 店铺列表 = app.ctx.cache.config?.stores || [];
      const 支持订单明细 = typeof 模板选项.读取店铺订单 === "function";

      if (this.state.detailStore) {
        const 镜像列表 = 构建店铺订单镜像(this.state.detailStore).镜像列表;
        const 可见列表 = 过滤订单镜像列表(镜像列表, this.state.detailFilterMode);
        const 内容高度 = app.contentHeight;
        if (按键 === "r") {
          全部订单缓存 = { 时间: 0, 列表: null };
          this.state.detailScroll = 0;
          this.state.detailSelectedIndex = 0;
          this.state.detailMessage = "店铺订单列表已刷新。";
          return true;
        }
        if (按键 === "f") {
          this.state.detailFilterMode = 切换订单过滤模式(this.state.detailFilterMode);
          this.state.detailSelectedIndex = 0;
          this.state.detailScroll = 0;
          return true;
        }
        if (按键 === "up") {
          this.state.detailSelectedIndex = Math.max(0, this.state.detailSelectedIndex - 1);
          this.state.detailScroll = Math.max(0, this.state.detailScroll - 1);
          return true;
        }
        if (按键 === "down") {
          this.state.detailSelectedIndex = Math.min(可见列表.length - 1, this.state.detailSelectedIndex + 1);
          this.state.detailScroll = Math.min(Math.max(0, 可见列表.length - Math.max(1, 内容高度 - 4)), this.state.detailScroll + 1);
          return true;
        }
        if (按键 === "pgup") {
          this.state.detailScroll = Math.max(0, this.state.detailScroll - Math.max(1, 内容高度 - 4));
          return true;
        }
        if (按键 === "pgdn") {
          this.state.detailScroll = Math.min(Math.max(0, 可见列表.length - Math.max(1, 内容高度 - 4)), this.state.detailScroll + Math.max(1, 内容高度 - 4));
          return true;
        }
        if (按键 === "home") {
          this.state.detailScroll = 0;
          this.state.detailSelectedIndex = 0;
          return true;
        }
        if (按键 === "end") {
          this.state.detailScroll = Math.max(0, 可见列表.length - Math.max(1, 内容高度 - 4));
          this.state.detailSelectedIndex = Math.max(0, 可见列表.length - 1);
          return true;
        }
        if (按键 === "a" && typeof 模板选项.订单页标记已安排 === "function") {
          const 订单 = 可见列表[this.state.detailSelectedIndex];
          if (!订单) return true;
          try {
            const 更新后订单 = 模板选项.订单页标记已安排(订单);
            全部订单缓存 = { 时间: 0, 列表: null };
            this.state.detailMessage = 更新后订单
              ? `已标记为已安排：${订单.orderNumber}`
              : `订单无需标记：${订单.orderNumber}`;
          } catch (错误) {
            this.state.detailMessage = 错误 instanceof Error ? 错误.message : String(错误);
          }
          return true;
        }
        if (按键 === "esc" || 按键 === "backspace" || 按键 === "enter") {
          this.state.detailStore = null;
          this.state.detailMessage = "";
          return true;
        }
        return false;
      }

      if (支持订单明细) {
        const 可见店数 = Math.max(1, app.contentHeight - 3);
        const 最大偏移 = Math.max(0, 店铺列表.length - 可见店数);
        if (按键 === "down") {
          if (this.state.selection < 店铺列表.length - 1) {
            this.state.selection += 1;
            if (this.state.selection - this.state.scrollOffset >= 可见店数) {
              this.state.scrollOffset = Math.min(最大偏移, this.state.scrollOffset + 1);
            }
          }
          return true;
        }
        if (按键 === "up") {
          if (this.state.selection > 0) {
            this.state.selection -= 1;
            if (this.state.selection < this.state.scrollOffset) {
              this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
            }
          }
          return true;
        }
        if (按键 === "enter") {
          const 店铺 = 店铺列表[this.state.selection];
          if (店铺) {
            this.state.detailStore = 店铺;
            this.state.detailScroll = 0;
            this.state.detailFilterMode = 0;
            this.state.detailSelectedIndex = 0;
          }
          return true;
        }
        if (按键 === "r" && typeof 模板选项.店铺页回车动作 === "function") {
          const 店铺 = 店铺列表[this.state.selection];
          if (店铺) {
            模板选项.店铺页回车动作(app, 店铺);
          }
          return true;
        }
        return false;
      }

      const 每店行数 = 2;
      const 可见店数 = Math.max(1, Math.floor(app.contentHeight / 每店行数) - 1);
      const 最大偏移 = Math.max(0, 店铺列表.length - 可见店数);
      if (按键 === "down") {
        if (this.state.selection < 店铺列表.length - 1) {
          this.state.selection += 1;
          if (this.state.selection - this.state.scrollOffset >= 可见店数) {
            this.state.scrollOffset = Math.min(最大偏移, this.state.scrollOffset + 1);
          }
        }
        return true;
      }
      if (按键 === "up") {
        if (this.state.selection > 0) {
          this.state.selection -= 1;
          if (this.state.selection < this.state.scrollOffset) {
            this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
          }
        }
        return true;
      }
      if (模板选项.店铺页回车动作 && 按键 === "enter") {
        const 店铺 = 店铺列表[this.state.selection];
        if (店铺) {
          模板选项.店铺页回车动作(app, 店铺);
        }
        return true;
      }
      return false;
    },
  };

  return 页面;
}

function 创建配置页(模板选项) {
  const 页面 = {
    key: "4",
    title: "配置",
    state: {
      selection: 0,
      message: "",
    },
    onEnter() {
      const 店铺列表 = this.ctx.cache.config?.stores || [];
      if (this.state.selection >= 店铺列表.length) {
        this.state.selection = Math.max(0, 店铺列表.length - 1);
      }
    },
    render(app) {
      const 上下文 = app.ctx;
      const 店铺列表 = Array.isArray(上下文.cache.config?.stores) ? 上下文.cache.config.stores : [];
      const 列数 = app.columns;

      const 行列表 = [];
      行列表.push(着色(适配宽度(`店铺配置（共 ${店铺列表.length} 家｜t 启用/停用）`, 列数), "brightBlue"));

      if (店铺列表.length === 0) {
        行列表.push(着色("当前没有店铺配置。", "gray"));
        return 行列表;
      }

      for (let 索引 = 0; 索引 < 店铺列表.length; 索引 += 1) {
        const 店铺 = 店铺列表[索引];
        const 选中 = 索引 === this.state.selection;
        const 启用文字 = 店铺.enabled === false ? 着色("停用", "gray") : 着色("启用", "brightGreen");
        const 地址 = String(店铺.targetUrl || "-");
        const 账号 = 脱敏账号(店铺.username || 店铺.phoneNumber || "");
        const 第一行 = `  [${索引 + 1}] ${店铺.name || "未命名"} (${店铺.id || "-"})｜${启用文字}｜账号：${账号}`;
        const 第二行 = `      登录地址：${地址}`;
        行列表.push(选中 ? 着色(适配宽度(第一行, 列数), "reverse") : 适配宽度(第一行, 列数));
        行列表.push(适配宽度(第二行, 列数));
      }

      行列表.push("");
      行列表.push(着色(`${模板选项.配置提示 || "新增、修改、删除店铺请使用 CLI 模式。"}`, "gray"));

      if (this.state.message) {
        行列表.push(着色(this.state.message, "brightYellow"));
      }

      return 行列表;
    },
    footer() {
      return "↑↓选择 t启用/停用 ←→切页 q返回总览";
    },
    handleKey(按键, app) {
      const 上下文 = app.ctx;
      const 店铺列表 = 上下文.cache.config?.stores || [];

      if (按键 === "down") {
        if (this.state.selection < 店铺列表.length - 1) {
          this.state.selection += 1;
        }
        return true;
      }
      if (按键 === "up") {
        if (this.state.selection > 0) {
          this.state.selection -= 1;
        }
        return true;
      }
      if (按键 === "t" || 按键 === "T") {
        const 店铺 = 店铺列表[this.state.selection];
        if (店铺) {
          try {
            上下文.services.切换店铺启用状态(店铺.id);
            this.state.message = `[完成] 已${店铺.enabled === false ? "启用" : "停用"}：${店铺.name}`;
          } catch (错误) {
            this.state.message = `[失败] ${错误 instanceof Error ? 错误.message : String(错误)}`;
          }
        }
        return true;
      }
      return false;
    },
  };

  return 页面;
}

function 创建订单页(模板选项) {
  let 订单缓存 = { 时间: 0, 列表: null };

  function 读取全部订单镜像列表(店铺列表 = []) {
    const 当前时间 = Date.now();
    if (订单缓存.列表 && 当前时间 - 订单缓存.时间 < 2000) {
      return 订单缓存.列表;
    }
    try {
      if (typeof 模板选项.读取全部订单 === "function") {
        订单缓存 = { 时间: 当前时间, 列表: 构建订单镜像列表(模板选项.读取全部订单() || []) };
      } else if (typeof 模板选项.读取店铺订单 === "function") {
        const 订单列表 = 店铺列表.flatMap((店铺) => 模板选项.读取店铺订单(店铺) || []);
        订单缓存 = { 时间: 当前时间, 列表: 构建订单镜像列表(订单列表) };
      } else {
        订单缓存 = { 时间: 当前时间, 列表: [] };
      }
    } catch {
      订单缓存 = { 时间: 当前时间, 列表: [] };
    }
    return 订单缓存.列表;
  }

  const 页面 = {
    key: "2",
    title: "订单",
    state: {
      scrollOffset: 0,
      selectedIndex: 0,
      filterMode: 0,
      detail: null,
      detailScroll: 0,
      message: "",
    },
    onEnter() {
      this.state.detail = null;
      this.state.detailScroll = 0;
    },
    render(app) {
      const 列数 = app.columns;
      const 内容高度 = app.contentHeight;
      const 店铺列表 = Array.isArray(app.ctx.cache.config?.stores) ? app.ctx.cache.config.stores : [];
      const 全部列表 = 读取全部订单镜像列表(店铺列表);
      const 过滤模式 = 订单过滤模式[this.state.filterMode] || 订单过滤模式[0];
      const 可见列表 = 过滤订单镜像列表(全部列表, this.state.filterMode);

      if (this.state.detail) {
        const 详情行 = 渲染订单详情(this.state.detail);
        const 最大偏移 = Math.max(0, 详情行.length - 内容高度);
        if (this.state.detailScroll > 最大偏移) this.state.detailScroll = 最大偏移;
        return 详情行.slice(this.state.detailScroll, this.state.detailScroll + 内容高度);
      }

      if (this.state.selectedIndex >= 可见列表.length) {
        this.state.selectedIndex = Math.max(0, 可见列表.length - 1);
      }
      const 可见行数 = Math.max(1, 内容高度 - 3);
      const 最大偏移 = Math.max(0, 可见列表.length - 可见行数);
      if (this.state.scrollOffset > 最大偏移) this.state.scrollOffset = 最大偏移;

      const 行列表 = [];
      行列表.push(着色(适配宽度(`订单明细（过滤:${过滤模式.label}，显示 ${可见列表.length}/${全部列表.length} 单，f 切换）`, 列数), "brightCyan"));
      const 宽度方案 = 构建订单表格宽度方案(列数, 模板选项.订单页扩展列, 可见列表);
      行列表.push(构建订单表格头(列数, 模板选项.订单页扩展列, 宽度方案));
      if (可见列表.length === 0) {
        行列表.push(着色("暂无同步到的订单明细。", "gray"));
        return 行列表;
      }
      const 起始索引 = this.state.scrollOffset;
      const 结束索引 = Math.min(可见列表.length, 起始索引 + 可见行数);
      for (let 索引 = 起始索引; 索引 < 结束索引; 索引 += 1) {
        const 行 = 构建订单表格行(索引, 可见列表[索引], 列数, 模板选项.订单页扩展列, 宽度方案);
        行列表.push(索引 === this.state.selectedIndex ? 着色(适配宽度(行, 列数), "reverse") : 适配宽度(行, 列数));
      }
      if (可见列表.length > 可见行数) {
        行列表.push(着色(适配宽度(`（共 ${可见列表.length} 单，↑↓滚动）`, 列数), "gray"));
      }
      if (this.state.message) {
        行列表.push(着色(`提示：${适配宽度(this.state.message, Math.max(1, 列数 - 4))}`, "brightYellow"));
      }
      return 行列表;
    },
    footer() {
      if (this.state.detail) {
        return "Home/End首尾 ↑↓滚动 回车/Esc返回订单列表 q返回总览";
      }
      const 过滤模式 = 订单过滤模式[this.state.filterMode] || 订单过滤模式[0];
      const 操作提示 = typeof 模板选项.订单页标记已安排 === "function" ? " a标记已安排" : "";
      return `f切换过滤[${过滤模式.label}] r刷新 Home/End首尾 ↑↓选择 回车查看详情${操作提示} ←→切页 q返回总览`;
    },
    handleKey(按键, app) {
      const 店铺列表 = Array.isArray(app.ctx.cache.config?.stores) ? app.ctx.cache.config.stores : [];
      const 全部列表 = 读取全部订单镜像列表(店铺列表);
      const 可见列表 = 过滤订单镜像列表(全部列表, this.state.filterMode);
      const 内容高度 = app.contentHeight;

      if (this.state.detail) {
        const 详情行 = 渲染订单详情(this.state.detail);
        const 最大偏移 = Math.max(0, 详情行.length - 内容高度);
        if (按键 === "up") {
          this.state.detailScroll = Math.max(0, this.state.detailScroll - 1);
          return true;
        }
        if (按键 === "down") {
          this.state.detailScroll = Math.min(最大偏移, this.state.detailScroll + 1);
          return true;
        }
        if (按键 === "pgup") {
          this.state.detailScroll = Math.max(0, this.state.detailScroll - 内容高度);
          return true;
        }
        if (按键 === "pgdn") {
          this.state.detailScroll = Math.min(最大偏移, this.state.detailScroll + 内容高度);
          return true;
        }
        if (按键 === "home") {
          this.state.detailScroll = 0;
          return true;
        }
        if (按键 === "end") {
          this.state.detailScroll = 最大偏移;
          return true;
        }
        if (按键 === "enter" || 按键 === "esc" || 按键 === "backspace") {
          this.state.detail = null;
          return true;
        }
        return false;
      }

      if (按键 === "r") {
        订单缓存 = { 时间: 0, 列表: null };
        this.state.selectedIndex = 0;
        this.state.scrollOffset = 0;
        this.state.message = "订单列表已刷新。";
        return true;
      }
      if (可见列表.length === 0) {
        if (按键 === "f") {
          this.state.filterMode = 切换订单过滤模式(this.state.filterMode);
          return true;
        }
        return false;
      }

      const 可见行数 = Math.max(1, 内容高度 - 3);
      const 最大偏移 = Math.max(0, 可见列表.length - 可见行数);
      if (按键 === "f") {
        this.state.filterMode = 切换订单过滤模式(this.state.filterMode);
        this.state.selectedIndex = 0;
        this.state.scrollOffset = 0;
        return true;
      }
      if (按键 === "up") {
        if (this.state.selectedIndex > 0) {
          this.state.selectedIndex -= 1;
          if (this.state.selectedIndex < this.state.scrollOffset) {
            this.state.scrollOffset = this.state.selectedIndex;
          }
        }
        return true;
      }
      if (按键 === "down") {
        if (this.state.selectedIndex < 可见列表.length - 1) {
          this.state.selectedIndex += 1;
          if (this.state.selectedIndex >= this.state.scrollOffset + 可见行数) {
            this.state.scrollOffset = this.state.selectedIndex - 可见行数 + 1;
          }
        }
        return true;
      }
      if (按键 === "pgup") {
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 可见行数);
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 可见行数);
        return true;
      }
      if (按键 === "pgdn") {
        this.state.selectedIndex = Math.min(可见列表.length - 1, this.state.selectedIndex + 可见行数);
        this.state.scrollOffset = Math.min(最大偏移, this.state.scrollOffset + 可见行数);
        return true;
      }
      if (按键 === "home") {
        this.state.selectedIndex = 0;
        this.state.scrollOffset = 0;
        return true;
      }
      if (按键 === "end") {
        this.state.selectedIndex = 可见列表.length - 1;
        this.state.scrollOffset = 最大偏移;
        return true;
      }
      if (按键 === "enter") {
        this.state.detail = 可见列表[this.state.selectedIndex];
        this.state.detailScroll = 0;
        return true;
      }
      if (按键 === "a" && typeof 模板选项.订单页标记已安排 === "function") {
        const 订单 = 可见列表[this.state.selectedIndex];
        try {
          const 更新后订单 = 模板选项.订单页标记已安排(订单);
          订单缓存 = { 时间: 0, 列表: null };
          this.state.message = 更新后订单
            ? `已标记为已安排：${订单.orderNumber}`
            : `订单无需标记：${订单.orderNumber}`;
        } catch (错误) {
          this.state.message = 错误 instanceof Error ? 错误.message : String(错误);
        }
        return true;
      }
      return false;
    },
  };

  return 页面;
}

function 创建回传平台TUI(选项 = {}) {
  // options: { 标题, 输出, 快捷操作, 操作动作, 总览附加行, 读取登录状态, 格式化结果,
  //            店铺页操作提示, 店铺页回车动作, 配置提示, 读取店铺配置, 保存店铺配置,
  //            切换店铺启用状态, 订阅日志 }
  const 标题 = 选项.标题 || "发票回传控制台";
  const 支持订单页 = typeof 选项.读取全部订单 === "function" || typeof 选项.读取店铺订单 === "function";
  const 店铺页 = 创建店铺页(选项);
  const 日志页 = 创建日志页(支持订单页 ? { key: "4", title: "日志" } : {});
  const 配置页 = 创建配置页(选项);
  if (支持订单页) {
    店铺页.key = "3";
    店铺页.title = "店铺";
    配置页.key = "5";
    配置页.title = "配置";
  }
  const 页面列表 = [
    创建总览页(选项),
    ...(支持订单页 ? [创建订单页(选项)] : []),
    店铺页,
    日志页,
    配置页,
  ];

  const ctx = {
    task: 选项.task || 创建初始任务(),
    cache: {
      config: null,
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
    statusBarProvider: (tuiApp) => {
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
      行列表.push(适配宽度(第一行, tuiApp.columns));
      if (任务.status === "running" && 任务.message) {
        行列表.push(着色(适配宽度(`   ${任务.message}`, tuiApp.columns), "brightYellow"));
      } else if (任务.message) {
        行列表.push(着色(适配宽度(`   ${任务.message}`, tuiApp.columns), "gray"));
      } else {
        行列表.push(适配宽度(`   使用说明：数字键或←→切页；任务执行过程实时显示在「${支持订单页 ? "4" : "3"}日志」页。`, tuiApp.columns));
      }
      return 行列表;
    },
  });
  app.ctx = ctx;
  ctx.app = app;

  ctx.services = {
    读取配置: () => 选项.读取店铺配置(),
    刷新外部服务状态: () => 刷新外部服务状态(),
    切换店铺启用状态: (店铺标识) => {
      const 当前配置 = 选项.读取店铺配置();
      const 店铺 = 当前配置.stores.find((item) => item.id === 店铺标识);
      if (!店铺) throw new Error(`未找到店铺：${店铺标识}`);
      店铺.enabled = 店铺.enabled === false;
      选项.保存店铺配置(当前配置);
      刷新缓存();
    },
    启动任务: async (任务执行函数) => {
      if (ctx.task.status === "running") {
        throw new Error("已有任务在运行中。");
      }
      ctx.task.status = "running";
      ctx.task.startedAt = new Date().toISOString();
      ctx.task.message = "任务已启动";
      app.requestRender();
      try {
        await 任务执行函数(ctx);
      } catch (错误) {
        ctx.task.status = "error";
        ctx.task.message = `任务失败：${错误.message}`;
      } finally {
        ctx.task.finishedAt = new Date().toISOString();
        ctx.task.currentStore = "";
        if (ctx.task.status === "running") {
          ctx.task.status = "done";
          ctx.task.message = ctx.task.message || "任务已完成。";
        }
        刷新缓存();
        app.requestRender();
      }
    },
    requestExit: () => {
      app.stop();
      if (typeof 取消日志订阅 === "function") 取消日志订阅();
      清空定时器();
      process.exit(0);
    },
  };

  页面列表.forEach((页面) => {
    页面.ctx = ctx;
  });

  let 取消日志订阅 = null;
  let 恢复控制台输出 = null;
  function 清空定时器() {
    定时器列表.forEach((定时器) => clearInterval(定时器));
    定时器列表 = [];
  }
  let 定时器列表 = [];

  // 日志通道：业务 console 输出全部重定向进日志页（屏幕不被污染），退出时恢复。
  const 记录日志行 = (行) => {
    日志页.pushLine(行);
    app.requestRender();
  };
  恢复控制台输出 = 开始捕获控制台输出(记录日志行);
  取消日志订阅 = typeof 选项.订阅日志 === "function"
    ? 选项.订阅日志(记录日志行)
    : null;

  const 刷新缓存 = () => {
    try {
      ctx.cache.config = 选项.读取店铺配置();
    } catch (错误) {
      // 缓存刷新失败不打断 TUI。
    }
  };

  let 服务状态检查中 = false;
  const 刷新外部服务状态 = async () => {
    if (typeof 选项.读取外部服务状态 !== "function" || 服务状态检查中) {
      return;
    }
    服务状态检查中 = true;
    if (!ctx.cache.serviceStatus) {
        ctx.cache.serviceStatus = { name: 选项.外部服务名称 || "外部服务", status: "checking", label: "检查中" };
      }
    app.requestRender();
    try {
      const result = await 选项.读取外部服务状态(ctx);
      ctx.cache.serviceStatus = {
        ...result,
        name: 选项.外部服务名称 || result?.name || "外部服务",
        status: result?.status || (result?.available ? "ready" : "error"),
        label: result?.label || (result?.available ? "可用" : "失效"),
        detail: result?.detail || "",
        items: Array.isArray(result?.items) ? result.items : undefined,
      };
    } catch (错误) {
      ctx.cache.serviceStatus = {
        name: 选项.外部服务名称 || "外部服务",
        status: "error",
        label: "失效",
        detail: String(错误?.message || 错误 || "健康检查失败"),
      };
    } finally {
      服务状态检查中 = false;
      app.requestRender();
    }
  };

  const 刷新缓存并渲染 = () => {
    刷新缓存();
    app.requestRender();
  };

  const 时钟定时器 = setInterval(() => app.requestRender(), 1000);
  const 缓存定时器 = setInterval(刷新缓存并渲染, 3000);
  const 服务状态定时器 = typeof 选项.读取外部服务状态 === "function"
    ? setInterval(() => { 刷新外部服务状态(); }, 3_000)
    : null;
  定时器列表.push(时钟定时器, 缓存定时器);
  if (服务状态定时器) 定时器列表.push(服务状态定时器);
  if (typeof 时钟定时器.unref === "function") 时钟定时器.unref();
  if (typeof 缓存定时器.unref === "function") 缓存定时器.unref();
  if (typeof 服务状态定时器?.unref === "function") 服务状态定时器.unref();

  刷新缓存();
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

module.exports = {
  创建回传平台TUI,
  创建日志页,
  创建初始任务,
  脱敏账号,
  提取日志时间,
};
