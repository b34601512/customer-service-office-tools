// 资源占用页：采样本项目进程树的 CPU 与内存占用，按角色分组展示。
const ansi = require("../ansi");
const { fit, padEnd, normalizeCellText } = require("../width");

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : "-";
}

function createResourcesPage() {
  const page = {
    key: "6",
    title: "资源",
    state: {
      resources: null,
      loading: false,
      message: ""
    },
    onEnter(app) {
      this.refresh(app);
    },
    async refresh(app) {
      if (this.state.loading) {
        return;
      }
      this.state.loading = true;
      this.state.message = "正在采样进程资源（约1秒）...";
      app.requestRender();
      try {
        const resources = await app.ctx.services.readResources();
        this.state.resources = resources;
        this.state.message = "";
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      } finally {
        this.state.loading = false;
        app.requestRender();
      }
    },
    render(app) {
      const columns = app.columns;
      const contentHeight = app.contentHeight;
      const lines = [];
      const resources = this.state.resources;

      lines.push(ansi.colorize(fit("项目进程资源占用（r 刷新）", columns), "brightBlue"));

      if (!resources) {
        lines.push(ansi.colorize(this.state.message || "正在采样...", "gray"));
        return lines;
      }

      const summaryLine =
        `CPU ${formatPercent(resources.cpuPercent)}  ` +
        `内存 ${resources.memoryWorkingSetText || "-"}  ` +
        `运行项 ${resources.processGroupCount ?? "-"}  ` +
        `进程 ${resources.processCount ?? "-"}`;
      lines.push(ansi.colorize(fit(summaryLine, columns), "brightGreen"));

      lines.push(ansi.colorize(fit(`${padEnd("运行项", 14)} ${padEnd("PID", 8)} ${padEnd("CPU", 8)} ${fit("内存", 12)} 说明`, columns), "brightCyan"));

      const groups = Array.isArray(resources.processGroups) ? resources.processGroups : [];
      let shown = 0;
      for (let index = 0; index < groups.length; index += 1) {
        if (shown >= contentHeight - 4) {
          break;
        }
        const group = groups[index];
        const line =
          `${fit(normalizeCellText(group.role || "项目进程"), 14)} ${fit(normalizeCellText(String(group.pid || "")), 8)} ` +
          `${fit(normalizeCellText(formatPercent(group.cpuPercent)), 8)} ${fit(normalizeCellText(group.memoryWorkingSetText || "-"), 12)} ` +
          `${fit(normalizeCellText(group.detailText || group.name || ""), columns - 50)}`;
        lines.push(fit(line, columns));
        shown += 1;
      }

      if (groups.length === 0) {
        lines.push(ansi.colorize("当前没有采集到项目进程。", "gray"));
      }

      if (this.state.message) {
        lines.push("");
        lines.push(ansi.colorize(`提示：${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    footer() {
      return "r刷新 ←→切页 q返回总览";
    },
    handleKey(key, app) {
      if (key === "r" || key === "f5") {
        this.refresh(app);
        return true;
      }
      return false;
    }
  };

  return page;
}

module.exports = {
  createResourcesPage,
  formatPercent
};
