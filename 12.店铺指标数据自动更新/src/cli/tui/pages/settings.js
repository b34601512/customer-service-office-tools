// 设置页：日期方式 / 汇总表路径 / 金山同步设置。读写全部走 services。
const ansi = require("../ansi");
const { fit } = require("../width");
const { titleBanner } = require("../gameUi");
const { formatDateSelection } = require("../../cliDashboard");
const { editKdocsSyncSettings } = require("../kdocsSettingsEditor");

function getSettingsActions(app, page) {
  const services = app.ctx.services;
  const config = services.readConfig();
  return [
    {
      label: config.dateSelection.mode === "automatic" ? "切换为手动单日" : "切换为智能方式",
      run: async (app) => {
        if (config.dateSelection.mode === "automatic") {
          const date = await app.requestInput({
            title: "手动采集日期（YYYY-MM-DD）",
            defaultValue: config.dateSelection.manual?.snapshotDate || ""
          });
          if (date === null) return;
          if (!services.isValidCalendarDate(date)) {
            page.state.message = "日期无效，请按 YYYY-MM-DD 输入真实日期。";
            app.requestRender();
            return;
          }
          services.saveDateSelection({ mode: "manual", manual: { snapshotDate: date } });
          page.state.message = "已切换为手动单日。";
        } else {
          services.saveDateSelection({ mode: "automatic" });
          page.state.message = "已切换为智能方式。";
        }
        app.requestRender();
      }
    },
    {
      label: "修改手动采集日期",
      run: async (app) => {
        const date = await app.requestInput({
          title: "手动采集日期（YYYY-MM-DD）",
          defaultValue: config.dateSelection.manual?.snapshotDate || ""
        });
        if (date === null) return;
        if (!services.isValidCalendarDate(date)) {
          page.state.message = "日期无效，请按 YYYY-MM-DD 输入真实日期。";
          app.requestRender();
          return;
        }
        services.saveDateSelection({ mode: "manual", manual: { snapshotDate: date } });
        page.state.message = "手动日期已更新。";
        app.requestRender();
      }
    },
    {
      label: "修改汇总表路径",
      run: async (app) => {
        const rawPath = await app.requestInput({
          title: "新汇总表路径（.xlsx，回车保留当前）",
          defaultValue: config.workbook.path || ""
        });
        if (rawPath === null) return;
        const normalizedPath = services.normalizeWorkbookPath(rawPath);
        if (!normalizedPath) {
          page.state.message = "路径为空，未修改。";
          app.requestRender();
          return;
        }
        try {
          services.validateWorkbookPath(normalizedPath);
          services.saveWorkbookPath(normalizedPath);
          page.state.message = "汇总表路径已保存。";
        } catch (error) {
          page.state.message = `路径无效：${String(error?.message || error)}`;
        }
        app.requestRender();
      }
    },
    { label: "修改金山同步设置", run: (app) => editKdocsSyncSettings(app, page) }
  ];
}

function createSettingsPage() {
  const page = {
    key: "4",
    title: "设置",
    state: { selection: 0, message: "" },
    render(app) {
      const services = app.ctx.services;
      const config = services.readConfig();
      const columns = app.columns;
      const lines = [];
      lines.push(...titleBanner("◆ 设置 ◆", columns - 2));
      lines.push(` 日期方式  ${formatDateSelection(config.dateSelection)}`);
      lines.push(` 汇总表    ${config.workbook.path || "未设置"}`);
      lines.push(` 金山同步  ${services.isKdocsSyncConfigured(config) ? ansi.colorize("[已配置]", "brightGreen") : ansi.colorize("[未配置]", "yellow")}`);
      lines.push("");
      lines.push(ansi.colorize("── 操作 ──", "brightCyan"));
      getSettingsActions(app, this).forEach((action, index) => {
        const row = ` ${index === this.state.selection ? "▶" : " "} ${action.label}`;
        lines.push(index === this.state.selection ? ansi.colorize(fit(row, columns), "reverse") : row);
      });
      if (this.state.message) {
        lines.push(ansi.colorize(` ${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    footer() {
      return "↑↓选择 回车执行  ←→/数字键切页";
    },
    handleKey(key, app) {
      const actionCount = Math.max(1, getSettingsActions(app, this).length);
      if (key === "up") {
        this.state.selection = (this.state.selection - 1 + actionCount) % actionCount;
        return true;
      }
      if (key === "down") {
        this.state.selection = (this.state.selection + 1) % actionCount;
        return true;
      }
      if (key === "enter") {
        const action = getSettingsActions(app, this)[this.state.selection];
        if (action) action.run(app);
        return true;
      }
      return false;
    }
  };
  return page;
}

module.exports = {
  createSettingsPage,
  getSettingsActions
};