// 汇总运行页：展示本轮任务清单与实时进度，支持开始汇总、单店/全部强制重新下载。
const ansi = require("../ansi");
const { fit, normalizeCellText } = require("../width");
const { formatDurationMs, formatProgressBar, formatSummaryTaskStatus } = require("../format");
const { isSummaryRunning } = require("./overview");

function formatTaskLine(task, columns) {
  const statusInfo = formatSummaryTaskStatus(task.status);
  const statusText = ansi.colorize(`[${statusInfo.label}]`, statusInfo.color);
  const body = [
    task.platformLabel,
    task.storeDisplayName,
    task.action || task.detail
  ].map(normalizeCellText).join(" · ");
  return `${statusText} ${body}`;
}

function createTasksPage() {
  const page = {
    key: "2",
    title: "汇总",
    state: { selection: 0, message: "", busy: false, scrollOffset: 0 },
    onEnter() {
      this.state.message = "";
    },
    startRun(app, { selectedSummaryTaskIds = null, forceRedownload = false } = {}) {
      if (this.state.busy) {
        this.state.message = "汇总正在进行中，请等待完成。";
        app.requestRender();
        return;
      }
      this.state.busy = true;
      this.state.message = forceRedownload ? "正在强制重新下载并汇总……" : "汇总已启动，出现滑块或验证时请在浏览器中人工处理。";
      app.requestRender();
      Promise.resolve()
        .then(() => app.ctx.services.runSummaryTask({ selectedSummaryTaskIds, forceRedownload }))
        .then((result) => {
          this.state.message = result?.detail || "汇总已结束。";
        })
        .catch((error) => {
          this.state.message = `汇总停止：${error instanceof Error ? error.message : String(error)}`;
        })
        .finally(() => {
          this.state.busy = false;
          app.requestRender();
        });
    },
    render(app) {
      const state = app.ctx.services.getState();
      const columns = app.columns;
      const contentHeight = app.contentHeight;
      const lines = [];

      const running = isSummaryRunning(state) || this.state.busy;
      const tasks = state.summaryTasks || [];
      const startedAt = state.summaryRunStartedAt ? new Date(state.summaryRunStartedAt) : null;
      const finishedAt = state.summaryRunFinishedAt ? new Date(state.summaryRunFinishedAt) : null;

      let header = `本轮汇总：${running ? ansi.colorize("[运行中]", "brightYellow") : tasks.length ? ansi.colorize("[已结束]", "gray") : ansi.colorize("[未开始]", "gray")}`;
      if (running && startedAt) {
        header += `  已运行 ${formatDurationMs(Date.now() - startedAt.getTime())}`;
      } else if (finishedAt && startedAt) {
        header += `  用时 ${formatDurationMs(finishedAt.getTime() - startedAt.getTime())}`;
      }
      lines.push(header);

      // 进度条：按本轮实际店铺数动态计算，加店减店自动适配。
      const doneCount = tasks.filter((task) => task.status === "success" || task.status === "error").length;
      if (tasks.length) {
        lines.push(ansi.colorize(formatProgressBar(doneCount, tasks.length), running ? "brightYellow" : "brightGreen"));
      }

      if (state.summaryResult?.detail) {
        const color = state.summaryResult.errorCount ? "brightRed" : "brightGreen";
        lines.push(`结果：${ansi.colorize(state.summaryResult.detail, color)}`);
      } else if (state.lastError && !running) {
        lines.push(`结果：${ansi.colorize(state.lastError, "brightRed")}`);
      }
      lines.push(ansi.colorize("─".repeat(Math.min(columns, 72)), "gray"));

      if (!tasks.length) {
        lines.push("");
        lines.push("尚无本轮任务。按 S 开始汇总全部启用店铺。");
        lines.push("重跑：↑↓选中店铺后回车=单店重跑（复用今天源表），F=全部强制重下（忽略旧源表）。");
      } else {
        // 选中行用于浏览与单店强制重下。
        const maxVisible = Math.max(1, contentHeight - 6);
        if (this.state.selection >= tasks.length) {
          this.state.selection = Math.max(0, tasks.length - 1);
        }
        if (this.state.selection < this.state.scrollOffset) {
          this.state.scrollOffset = this.state.selection;
        }
        if (this.state.selection >= this.state.scrollOffset + maxVisible) {
          this.state.scrollOffset = this.state.selection - maxVisible + 1;
        }
        for (let index = this.state.scrollOffset; index < tasks.length; index += 1) {
          if (index >= this.state.scrollOffset + maxVisible) {
            lines.push(ansi.colorize(`  …还有 ${tasks.length - index} 家店铺`, "gray"));
            break;
          }
          const selected = index === this.state.selection;
          const line = `${selected ? "▶ " : "  "}${formatTaskLine(tasks[index], columns)}`;
          lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        }
      }

      lines.push("");
      lines.push(running
        ? ansi.colorize("汇总进行中：请在自动打开的浏览器中完成登录/滑块，程序会原地等待。", "brightYellow")
        : ansi.colorize("S 开始全部汇总    F 全部强制重下    回车 单店重跑    q 返回总览", "gray"));

      if (this.state.message) {
        lines.push(ansi.colorize(`提示：${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    footer() {
      return "↑↓浏览 S开始汇总 F强制重下(全部) 回车=选中店铺单店重跑 | ←→切页 Ctrl+C退出";
    },
    handleKey(key, app) {
      const state = app.ctx.services.getState();
      const tasks = state.summaryTasks || [];
      const running = isSummaryRunning(state) || this.state.busy;

      if (key === "up" || key === "down") {
        if (!tasks.length) return true;
        const direction = key === "down" ? 1 : -1;
        this.state.selection = Math.min(tasks.length - 1, Math.max(0, this.state.selection + direction));
        return true;
      }
      if (running) {
        return key !== "left" && key !== "right" ? true : false;
      }
      if (key === "s" || key === "S") {
        this.startRun(app, {});
        return true;
      }
      if (key === "f" || key === "F") {
        this.confirmAndRunAll(app);
        return true;
      }
      if (key === "enter" && tasks.length) {
        this.confirmAndRunOne(app, tasks[this.state.selection]);
        return true;
      }
      return false;
    },
    async confirmAndRunAll(app) {
      const confirmed = await app.requestConfirm("确认对全部启用店铺强制重新下载并汇总？");
      if (confirmed) {
        this.startRun(app, { forceRedownload: true });
      }
    },
    async confirmAndRunOne(app, task) {
      if (!task) return;
      const confirmed = await app.requestConfirm(`确认重跑「${task.storeDisplayName}」并汇总？（复用今天已下载源文件，不清空其他店铺数据）`);
      if (confirmed) {
        this.startRun(app, { selectedSummaryTaskIds: [task.id], forceRedownload: false });
      }
    }
  };
  return page;
}

module.exports = { createTasksPage, formatTaskLine };
