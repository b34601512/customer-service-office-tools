// 金山页：一键同步数据源 / 打开脚本 / 修改设置 / 打开在线文档。
const ansi = require("../ansi");
const { fit } = require("../width");
const { spinner, titleBanner } = require("../gameUi");
const { editKdocsSyncSettings } = require("../kdocsSettingsEditor");

function getKdocsActions(app, page) {
  const services = app.ctx.services;
  return [
    {
      label: "一键同步数据源",
      run: async (app) => {
        if (page.state.busy) return;
        page.state.busy = true;
        page.state.message = "正在清空在线“数据源”并从 A1 镜像本地，请稍候…";
        app.requestRender();
        try {
          const result = await services.runKdocsDataSourceSync();
          page.state.message = `金山文档镜像完成：${result.remoteDataRowCount} 行，在线与本地逐格一致。`;
        } catch (error) {
          page.state.message = `同步失败：${String(error?.message || error)}`;
        } finally {
          page.state.busy = false;
          app.requestRender();
        }
      }
    },
    {
      label: "打开数据源脚本",
      run: async (app) => {
        try {
          await services.openKdocsScript();
          page.state.message = "已打开 AirScript 脚本文件。";
        } catch (error) {
          page.state.message = `打开失败：${String(error?.message || error)}`;
        }
        app.requestRender();
      }
    },
    { label: "修改同步设置", run: (app) => editKdocsSyncSettings(app, page) },
    {
      label: "打开在线文档",
      run: async (app) => {
        try {
          await services.openKdocsDocument();
          page.state.message = "已打开在线文档。";
        } catch (error) {
          page.state.message = `打开失败：${String(error?.message || error)}`;
        }
        app.requestRender();
      }
    }
  ];
}

function createKdocsPage() {
  const page = {
    key: "5",
    title: "金山",
    state: { selection: 0, message: "", busy: false },
    render(app) {
      const services = app.ctx.services;
      const config = services.readConfig();
      const syncSettings = config.kdocsDataSourceSync || {};
      const columns = app.columns;
      const lines = [];
      lines.push(...titleBanner("◆ 金山文档同步 ◆", columns - 2));
      lines.push(` 同步状态  ${services.isKdocsSyncConfigured(config) ? ansi.colorize("[已配置]", "brightGreen") : ansi.colorize("[未配置]", "yellow")}`);
      lines.push(` 本地来源  ${config.workbook.path || "未设置"}`);
      lines.push(` 在线文档  ${syncSettings.documentUrl || "未设置"}`);
      lines.push("");
      lines.push(ansi.colorize("── 操作 ──", "brightCyan"));
      getKdocsActions(app, this).forEach((action, index) => {
        const row = ` ${index === this.state.selection ? "▶" : " "} ${action.label}`;
        lines.push(index === this.state.selection ? ansi.colorize(fit(row, columns), "reverse") : row);
      });
      if (this.state.busy) {
        lines.push(ansi.colorize(` ${spinner(Math.floor(Date.now() / 1000))} 同步进行中…`, "brightYellow"));
      } else if (this.state.message) {
        lines.push(ansi.colorize(` ${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    footer() {
      return "↑↓选择 回车执行  ←→/数字键切页";
    },
    handleKey(key, app) {
      const actionCount = Math.max(1, getKdocsActions(app, this).length);
      if (key === "up") {
        this.state.selection = (this.state.selection - 1 + actionCount) % actionCount;
        return true;
      }
      if (key === "down") {
        this.state.selection = (this.state.selection + 1) % actionCount;
        return true;
      }
      if (key === "enter") {
        const action = getKdocsActions(app, this)[this.state.selection];
        if (action) action.run(app);
        return true;
      }
      return false;
    }
  };
  return page;
}

module.exports = {
  createKdocsPage,
  getKdocsActions
};