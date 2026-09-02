// 总览页：任务状态、登录态、监控巡检摘要、最近处理记录、快捷操作。
const ansi = require("../ansi");
const { fit, padEnd } = require("../width");
const {
  formatDurationMs,
  formatBool,
  formatTaskStatus,
  formatLoginStatus,
  formatDateTimeText
} = require("../format");

function buildActions(state, loginStatus = {}) {
  const task = state.currentTask;
  const running = Boolean(task && task.status === "running");
  const awaiting = Boolean(task?.awaitingConfirmation);
  // 登录态无效（未验证/已失效）且当前没有任务在跑时，首次登录最需要被看到。
  const loginNeedsAttention = !running && loginStatus?.isValid !== true;

  const loginAction = { id: "login", label: "首次登录", enabled: !running, hint: "新电脑或登录态失效时执行" };
  const startAction = { id: "start", label: "后台启动", enabled: !running && !awaiting, hint: "启动超时/转接/漏回复/上班监控/下班监控" };
  const confirmAction = { id: "confirm", label: "完成登录并继续", enabled: true, urgent: true, hint: "已在浏览器完成登录后回车确认" };
  const stopAction = { id: "stop", label: "停止并退出任务", enabled: true, hint: "结束后台督办轮询" };
  const exitAction = { id: "exit", label: "退出控制台", enabled: true, danger: true, hint: "停止全部后台进程并关闭" };

  const actions = [];
  // 登录失效时首次登录置顶；已登录则沉底，让常用功能排第一。
  if (loginNeedsAttention) {
    actions.push(loginAction);
  }
  actions.push(startAction);
  if (awaiting) {
    actions.push(confirmAction);
  }
  if (task?.taskName === "start" && running) {
    actions.push(stopAction);
  }
  actions.push(exitAction);
  if (!loginNeedsAttention) {
    actions.push(loginAction);
  }
  return actions;
}

function formatFreshnessAge(ageSeconds) {
  const numericAgeSeconds = Number(ageSeconds);
  if (!Number.isFinite(numericAgeSeconds) || numericAgeSeconds < 0) {
    return "暂无";
  }
  return `${Math.floor(numericAgeSeconds / 60)} 分钟前`;
}

function formatMonitorLine(monitorSummary, dataFreshness) {
  const summary = monitorSummary || {};
  const freshness = dataFreshness || {};
  const detail = summary.detailText || "后台启动后，这里显示最近一次真实客户判定。";
  const stateText = summary.stateText || "等待判定";
  const attentionCount = Number(summary.attentionCount || 0);
  const stateColor = attentionCount > 0 ? "brightRed" : "brightGreen";
  const freshnessText = `（数据最后扫描 ${formatFreshnessAge(freshness.ageSeconds)}）`;
  const freshnessColor = freshness.stale ? "brightRed" : "gray";
  return `巡检：${ansi.colorize(stateText, stateColor)}  ${detail} ${ansi.colorize(freshnessText, freshnessColor)}`;
}

function ensureEnabledSelection(state, actions) {
  // 这里把选中项校正到第一个可用动作，保证默认就显示高亮，不用等用户按一次键。
  const enabledIndexes = actions.map((action, index) => (action.enabled ? index : -1)).filter((index) => index >= 0);
  if (enabledIndexes.length > 0 && !enabledIndexes.includes(state?.selection)) {
    state.selection = enabledIndexes[0];
  }
}

function createOverviewPage() {
  const page = {
    key: "1",
    title: "总览",
    state: {
      selection: 0,
      message: ""
    },
    onEnter() {
      // 进入页面时按最新状态重建可执行动作，选中项尽量保持在有效范围内。
      const actions = buildActions(this.ctx.state, this.ctx.cache.loginStatus);
      ensureEnabledSelection(this.state, actions);
    },
    render(app) {
      const ctx = app.ctx;
      const state = ctx.state;
      const task = state.currentTask;
      const loginStatus = ctx.cache.loginStatus;
      const actions = buildActions(state, loginStatus);
      // 渲染前也校正一次：后台运行等状态变化后，当前选中项可能已经不可用。
      ensureEnabledSelection(this.state, actions);
      const dashboard = ctx.cache.dashboard || {};

      const lines = [];
      const taskStatus = formatTaskStatus(task);
      const taskLabel = task ? task.label || task.taskName : "无";
      let taskLine = `任务：${ansi.colorize(`[${taskStatus.label}]`, taskStatus.color)} ${taskLabel}`;
      if (task && task.status === "running" && task.startedAt) {
        taskLine += `  已运行 ${formatDurationMs(Date.now() - new Date(task.startedAt).getTime())}`;
      }
      if (task?.pid) {
        taskLine += `  PID ${task.pid}`;
      }
      if (task?.message) {
        taskLine += `  说明：${task.message}`;
      }
      lines.push(taskLine);

      const login = formatLoginStatus(loginStatus);
      let loginLine = `登录态：${ansi.colorize(`[${login.label}]`, login.color)}`;
      if (loginStatus?.verifiedAt) {
        loginLine += `  验证时间 ${loginStatus.verifiedAt}`;
      }
      if (loginStatus?.targetUrl) {
        loginLine += `  地址 ${loginStatus.targetUrl}`;
      }
      lines.push(loginLine);

      lines.push(formatMonitorLine(dashboard.monitorSummary, dashboard.dataFreshness));

      const latestRecord = dashboard.latestRecord || {};
      lines.push(
        `最近处理：${formatDateTimeText(latestRecord.occurredAt)}  ${latestRecord.customerName || "暂无"}  ` +
          `${latestRecord.statusLabel || ""}  ${latestRecord.assigneeName ? `接待=${latestRecord.assigneeName}` : ""}`
      );
      if (latestRecord.reason) {
        lines.push(`          ${latestRecord.reason}`);
      }

      lines.push("");
      lines.push(ansi.colorize("快捷操作（↑↓选择 回车执行）", "brightBlue"));
      const columns = app.columns;
      let shown = 0;
      for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index];
        const selected = index === this.state.selection;
        const marker = action.enabled ? (selected ? "▶ " : "  ") : "  ";
        let label = action.label;
        if (action.enabled && action.urgent) {
          label = ansi.colorize(label, "brightYellow");
        } else if (action.enabled && action.danger) {
          label = ansi.colorize(label, "brightRed");
        } else if (!action.enabled) {
          label = ansi.colorize(label, "gray");
        }
        const hint = action.enabled ? `  ${action.hint || ""}` : ansi.colorize("  （当前不可用）", "gray");
        const line = `${marker}${label}${hint}`;
        lines.push(selected && action.enabled ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        shown += 1;
        if (shown >= 9) {
          break;
        }
      }

      if (this.state.message) {
        lines.push("");
        lines.push(ansi.colorize(`提示：${this.state.message}`, "brightYellow"));
      }

      return lines;
    },
    footer() {
      return "1总览 2客户 3日志 4配置 5企微 6资源 7报表 | ↑↓选择 回车执行 ←→/数字键切页 Ctrl+C退出";
    },
    handleKey(key, app) {
      const actions = buildActions(app.ctx.state, app.ctx.cache.loginStatus);
      if (key === "up" || key === "down") {
        const enabledIndexes = actions.map((action, index) => (action.enabled ? index : -1)).filter((index) => index >= 0);
        if (enabledIndexes.length === 0) {
          return true;
        }
        const direction = key === "down" ? 1 : -1;
        let currentPosition = enabledIndexes.indexOf(this.state.selection);
        if (currentPosition < 0) {
          currentPosition = 0;
        }
        currentPosition = (currentPosition + direction + enabledIndexes.length) % enabledIndexes.length;
        this.state.selection = enabledIndexes[currentPosition];
        return true;
      }

      if (key === "enter") {
        const action = actions[this.state.selection];
        if (!action || !action.enabled) {
          return true;
        }
        this.executeAction(action, app);
        return true;
      }

      return false;
    },
    async executeAction(action, app) {
      const ctx = app.ctx;
      this.state.message = "";
      try {
        if (action.id === "login") {
          await ctx.services.startTask("login");
          this.state.message = "首次登录已启动，请在弹出的浏览器窗口中完成登录。";
        } else if (action.id === "start") {
          await ctx.services.startTask("start");
          this.state.message = "后台督办已启动。";
        } else if (action.id === "confirm") {
          ctx.services.confirmLogin();
          this.state.message = "已发送登录完成确认。";
        } else if (action.id === "stop") {
          await ctx.services.stopTask();
          this.state.message = "停止指令已发送，正在收尾后台任务。";
        } else if (action.id === "exit") {
          ctx.services.requestExit();
          return;
        }
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      }
      app.requestRender();
    }
  };

  return page;
}

module.exports = {
  createOverviewPage,
  buildActions,
  ensureEnabledSelection,
  formatMonitorLine
};
