// 总览页：只保留快捷操作，运行状态和采集细节统一在汇总页展示。
const ansi = require("../ansi");
const { fit } = require("../width");

function findPageIndex(app, key) {
  return app.pages.findIndex((pageItem) => pageItem.key === key);
}

function runOpenAction(app, page, serviceMethod, successMessage) {
  return async () => {
    page.state.message = `正在打开${successMessage}…`;
    app.requestRender();
    try {
      await app.ctx.services[serviceMethod]();
      page.state.message = `已打开${successMessage}。`;
    } catch (error) {
      page.state.message = `打开失败：${String(error?.message || error)}`;
    }
    app.requestRender();
  };
}

function createOverviewPage() {
  const page = {
    key: "1",
    title: "总览",
    state: { selection: 0, message: "" },
    onEnter(app) {
      this.state.selection = 0;
    },
    getActions(app) {
      return [
        {
          label: "开始汇总",
          run: (app) => {
            const tasksIndex = findPageIndex(app, "2");
            app.switchPage(tasksIndex);
            app.pages[tasksIndex].startRun(app, {
              forceRecollect: false,
              collectionScope: { type: "all" }
            });
          }
        },
        {
          label: "强制重新采集",
          run: (app) => {
            const tasksIndex = findPageIndex(app, "2");
            app.switchPage(tasksIndex);
            app.pages[tasksIndex].startForceRecollect(app);
          }
        },
        { label: "店铺管理", run: (app) => app.switchPage(findPageIndex(app, "3")) },
        { label: "金山文档同步", run: (app) => app.switchPage(findPageIndex(app, "5")) },
        {
          label: "打开凭证文件夹",
          run: runOpenAction(app, page, "openRecentEvidenceFolder", "凭证文件夹")
        },
        {
          label: "打开汇总文件夹",
          run: runOpenAction(app, page, "openWorkbookDirectory", "汇总文件夹")
        },
        { label: "退出控制台", run: (app) => app.onExitRequest() }
      ];
    },
    render(app) {
      const columns = app.columns;
      const lines = [];

      lines.push(ansi.colorize("── 操作 ──", "brightCyan"));
      this.getActions(app).forEach((action, index) => {
        const row = ` ${index === this.state.selection ? "▶" : " "} ${action.label}`;
        lines.push(index === this.state.selection ? ansi.colorize(fit(row, columns), "reverse") : row);
      });
      if (this.state.message) {
        lines.push(ansi.colorize(` ${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    footer() {
      return "↑↓选择 回车执行   ←→/数字键切页   0退出   Ctrl+C确认退出";
    },
    handleKey(key, app) {
      const actionCount = Math.max(1, this.getActions(app).length);
      if (key === "up") {
        this.state.selection = (this.state.selection - 1 + actionCount) % actionCount;
        return true;
      }
      if (key === "down") {
        this.state.selection = (this.state.selection + 1) % actionCount;
        return true;
      }
      if (key === "enter") {
        const action = this.getActions(app)[this.state.selection];
        if (action) action.run(app);
        return true;
      }
      if (key === "0") {
        app.onExitRequest();
        return true;
      }
      return false;
    }
  };
  return page;
}

module.exports = {
  createOverviewPage,
  findPageIndex
};
