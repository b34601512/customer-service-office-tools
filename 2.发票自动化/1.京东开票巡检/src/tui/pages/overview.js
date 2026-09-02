// 总览页：任务状态、店铺概览、最近巡检摘要、快捷操作。
const { 着色 } = require("../共享路径").ansi;
const { 适配宽度 } = require("../共享路径").width;
const { 格式化时长毫秒, 格式化时间文本, 格式化任务状态 } = require("../共享路径").format;
const { 判断诺诺登录就绪 } = require("../../../../共享CLI/启动下载中心");

function 构建快捷操作(上下文) {
  const 任务 = 上下文.task;
  const 运行中 = Boolean(任务 && 任务.status === "running");
  const 操作列表 = [];
  操作列表.push({ id: "batch", 标签: "批量巡检", 可用: !运行中, 提示: "巡检全部启用店铺，浏览器可见且保持打开" });
  操作列表.push({ id: "single", 标签: "单店巡检", 可用: !运行中, 提示: "选择一家店铺执行可见巡检，完成后浏览器保持打开" });
  const 下载中心操作 = { id: "download-center", 标签: "发票下载中心", 可用: !运行中, 提示: "打开下载中心，检查诺诺登录或管理发票文件" };
  // 批量巡检固定置于第一项；未登录时下载中心仍优先于单店巡检，登录后沉到底部。
  if (判断诺诺登录就绪(上下文?.cache?.serviceStatus)) {
    操作列表.push(下载中心操作);
  } else {
    操作列表.splice(1, 0, 下载中心操作);
  }
  操作列表.push({ id: "exit", 标签: "退出控制台", 可用: true, 危险: true, 提示: "关闭 TUI 界面" });
  return 操作列表;
}

function 格式化巡检摘要行(摘要) {
  if (!摘要) {
    return null;
  }
  const 状态颜色 = 摘要.status === "success" ? "brightGreen" : "brightRed";
  const 结果标签 = 摘要.resultLabel || (摘要.status === "success" ? "巡检成功" : "巡检有问题");
  return `最近巡检：${着色(`[${结果标签}]`, 状态颜色)} 店铺 ${摘要.storeCount || 0} 家（成功 ${摘要.successStoreCount || 0}、失败 ${摘要.failedStoreCount || 0}、未完成 ${摘要.uncheckedStoreCount || 0}）｜${格式化时间文本(摘要.finishedAt)}`;
}

function 创建总览页() {
  const 页面 = {
    key: "1",
    title: "总览",
    state: {
      selection: 0,
      message: "",
    },
    onEnter() {
      const 操作列表 = 构建快捷操作(this.ctx);
      const 可用索引列表 = 操作列表.map((操作, 索引) => (操作.可用 ? 索引 : -1)).filter((索引) => 索引 >= 0);
      if (可用索引列表.length > 0 && !可用索引列表.includes(this.state.selection)) {
        this.state.selection = 可用索引列表[0];
      }
    },
    render(app) {
      const 上下文 = app.ctx;
      const 任务 = 上下文.task;
      const 配置 = 上下文.cache.config || { stores: [] };
      const 结果 = 上下文.cache.results || { stores: {} };
      const 店铺列表 = Array.isArray(配置.stores) ? 配置.stores : [];
      const 启用店铺 = 店铺列表.filter((店铺) => 店铺.enabled !== false);
      const 操作列表 = 构建快捷操作(上下文);

      const 行列表 = [];

      // 任务状态
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

      // 店铺概览
      const 启用数量 = 启用店铺.length;
      行列表.push(`店铺：共 ${店铺列表.length} 家｜启用 ${着色(String(启用数量), 启用数量 > 0 ? "brightGreen" : "gray")}｜已出结果 ${Object.keys(结果.stores || {}).length} 家`);

      // 最近巡检摘要
      const 摘要行 = 格式化巡检摘要行(结果.lastRunSummary || 结果.lastBatchSummary);
      if (摘要行) {
        行列表.push(摘要行);
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
        const 提示 = 操作.可用 ? `  ${操作.提示 || ""}` : 着色("  （巡检进行中，暂不可用）", "gray");
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
      return "1总览 2店铺 3日志 4配置 | ↑↓选择 回车执行 ←→切页 Ctrl+C退出";
    },
    handleKey(按键, app) {
      const 操作列表 = 构建快捷操作(app.ctx);
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
        if (操作.id === "single") {
          const 店铺列表 = (上下文.cache.config?.stores || []).filter((店铺) => 店铺.enabled !== false);
          if (店铺列表.length === 0) {
            this.state.message = "当前没有启用中的店铺，请先在配置页确认店铺状态。";
          } else if (店铺列表.length === 1) {
            await 上下文.services.启动单店巡检(店铺列表[0]);
            this.state.message = `单店巡检已启动：${店铺列表[0].name}。浏览器可见，完成后保持打开。`;
          } else {
            await 上下文.services.选择并巡检店铺();
            this.state.message = "单店巡检已启动。";
          }
        } else if (操作.id === "batch") {
          await 上下文.services.启动批量巡检();
          this.state.message = "批量巡检已启动，浏览器可见，全部完成后窗口保持打开。";
        } else if (操作.id === "download-center") {
          上下文.services.打开下载中心();
          this.state.message = "已在独立窗口打开发票下载中心。";
        } else if (操作.id === "exit") {
          上下文.services.requestExit();
          return;
        }
      } catch (错误) {
        this.state.message = 错误 instanceof Error ? 错误.message : String(错误);
      }
      app.requestRender();
    },
  };

  return 页面;
}

module.exports = {
  创建总览页,
  构建快捷操作,
  格式化巡检摘要行,
};
