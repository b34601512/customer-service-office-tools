// 金山文档同步页：状态总览 + 三个同步动作 + 脚本/设置/在线文档入口。
const ansi = require("../ansi");
const { fit, padEnd, normalizeCellText } = require("../width");
const { isKdocsSyncConfigured, requireValidKdocsDocumentUrl, requireValidKdocsWebhookUrl } = require("../../../kdocsSync/kdocsSyncSettings");

function buildActions(settings) {
  const ready = (slot) => isKdocsSyncConfigured(settings, slot) ? ansi.colorize("已配置", "brightGreen") : ansi.colorize("未配置", "yellow");
  return [
    { id: "sync", label: "一键同步明细", hint: "本地“数据明细”全量覆盖在线同名表并回读核对" },
    { id: "filter", label: "设置透视筛选日期", hint: "回车取数据最新日期；填写时用自定义日期" },
    { id: "names", label: "原样确认客服姓名勾选", hint: "读取原勾选→原样重应用→刷新保存" },
    { id: "settings", label: "修改同步设置", hint: `同步${ready("sync")} 筛选${ready("filter")} 客服姓名${ready("customerServiceName")}` },
    { id: "document", label: "打开在线文档", hint: "" },
    { id: "scriptSync", label: "打开同步脚本", hint: "AirScript-同步数据明细.txt" },
    { id: "scriptFilter", label: "打开筛选脚本", hint: "AirScript-筛选透视结果.txt" },
    { id: "scriptNames", label: "打开客服姓名脚本", hint: "AirScript-原样确认客服姓名勾选.txt" }
  ];
}

function createKdocsPage() {
  const page = {
    key: "5",
    title: "金山",
    state: { selection: 0, message: "", busyText: "" },
    onEnter() {
      this.state.message = "";
    },
    render(app) {
      const columns = app.columns;
      const lines = [];
      const projectConfig = this.ctx.services.readConfig();
      const settings = projectConfig?.kdocsDataDetailSync || {};
      lines.push(ansi.colorize("金山文档同步（↑↓选择 回车执行）", "brightBlue"));
      lines.push(`在线文档：${settings.documentUrl || ansi.colorize("未设置", "yellow")}`);
      lines.push(`本地来源：${projectConfig?.workbook?.path || "未设置"}`);
      lines.push(ansi.colorize("─".repeat(Math.min(columns, 72)), "gray"));
      const actions = buildActions(settings);
      if (this.state.selection >= actions.length) this.state.selection = 0;
      actions.forEach((action, index) => {
        const selected = index === this.state.selection;
        const line = `${selected ? "▶ " : "  "}${padEnd(normalizeCellText(action.label), 20)}${ansi.colorize(normalizeCellText(action.hint || ""), "gray")}`;
        lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
      });
      lines.push("");
      lines.push(ansi.colorize("首次配置：在线文档里建三个共享脚本并粘贴模板，生成令牌/webhook 后填入设置。", "gray"));
      lines.push(ansi.colorize("详细说明：src/kdocsSync/AirScript-客服姓名确认说明.md", "gray"));
      if (this.state.busyText) {
        lines.push("");
        lines.push(ansi.colorize(`⏳ ${this.state.busyText}`, "brightYellow"));
      }
      if (this.state.message) {
        lines.push("");
        lines.push(ansi.colorize(`提示：${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    footer() {
      return "↑↓选择 回车执行 | ←→切页 Ctrl+C退出";
    },
    handleKey(key, app) {
      const actions = buildActions(this.ctx.services.readConfig()?.kdocsDataDetailSync || {});
      if (key === "up") { this.state.selection = Math.max(0, this.state.selection - 1); return true; }
      if (key === "down") { this.state.selection = Math.min(actions.length - 1, this.state.selection + 1); return true; }
      if (key === "enter") {
        this.executeAction(actions[this.state.selection], app);
        return true;
      }
      return false;
    },
    async executeAction(action, app) {
      if (!action) return;
      const services = this.ctx.services;
      this.state.message = "";
      try {
        if (action.id === "sync") {
          this.state.busyText = "正在同步金山文档（写入、保存并真实回读）……";
          app.requestRender();
          const syncResult = await services.runKdocsDataDetailSync();
          this.state.message = `同步完成：在线真实回读 ${syncResult.remoteDataRowCount} 行` +
            (syncResult.clearedTailRowCount ? `，清除旧数据多出 ${syncResult.clearedTailRowCount} 行` : "");
        } else if (action.id === "filter") {
          const filterDate = await app.requestInput({ title: "筛选日期（回车=数据最新日期；填写 YYYY-MM-DD=自定义）" });
          if (filterDate === null) return;
          this.state.busyText = "正在修改透视筛选日期并刷新……";
          app.requestRender();
          const updateResult = await services.runKdocsPivotEndDateFilterUpdate(filterDate);
          if (updateResult.failedPivotTableCount) {
            this.state.message = `有 ${updateResult.failedPivotTableCount} 个透视表失败：` +
              updateResult.failedPivotTables.map((item) => `第${item.pivotTableIndex}个 ${item.errorMessage || "未知错误"}`).join("；");
          } else {
            this.state.message = `透视筛选已设为 ${updateResult.filterDate}。`;
          }
        } else if (action.id === "names") {
          this.state.busyText = "正在原样确认客服姓名勾选……";
          app.requestRender();
          const updateResult = await services.runKdocsCustomerServiceNameFilterReapply();
          if (updateResult.failedPivotTableCount) {
            this.state.message = `有 ${updateResult.failedPivotTableCount} 个透视表失败：` +
              updateResult.failedPivotTables.map((item) => `第${item.pivotTableIndex}个 ${item.errorMessage || "未知错误"}`).join("；");
          } else {
            this.state.message = "客服姓名勾选已原样确认并刷新保存。";
          }
        } else if (action.id === "settings") {
          await this.editSyncSettings(app);
        } else if (action.id === "document") {
          const documentUrl = requireValidKdocsDocumentUrl(this.ctx.services.readConfig().kdocsDataDetailSync?.documentUrl);
          await services.openUrl(documentUrl);
        } else if (action.id === "scriptSync") {
          await services.openKdocsScript("AirScript-同步数据明细.txt");
        } else if (action.id === "scriptFilter") {
          await services.openKdocsScript("AirScript-筛选透视结果.txt");
        } else if (action.id === "scriptNames") {
          await services.openKdocsScript("AirScript-原样确认客服姓名勾选.txt");
        }
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      } finally {
        this.state.busyText = "";
        app.requestRender();
      }
    },
    async editSyncSettings(app) {
      const currentSettings = this.ctx.services.readConfig().kdocsDataDetailSync || {};
      const fields = [
        { key: "documentUrl", title: "在线文档分享地址", secret: false },
        { key: "syncWebhookUrl", title: "同步脚本 webhook", secret: false },
        { key: "syncApiToken", title: "同步脚本令牌", secret: true },
        { key: "filterWebhookUrl", title: "筛选脚本 webhook", secret: false },
        { key: "filterApiToken", title: "筛选脚本令牌", secret: true },
        { key: "customerServiceNameWebhookUrl", title: "客服姓名脚本 webhook", secret: false },
        { key: "customerServiceNameApiToken", title: "客服姓名脚本令牌", secret: true }
      ];
      const nextSettings = { ...currentSettings };
      for (const field of fields) {
        const currentDisplay = field.secret ? "（保密输入）" : currentSettings[field.key] || "未设置";
        const value = await app.requestInput({ title: `${field.title}（当前 ${currentDisplay}，空=保留）`, secret: field.secret });
        if (value === null) {
          this.state.message = "已取消，设置未修改。";
          return;
        }
        if (value) {
          if (field.key === "documentUrl") {
            nextSettings.documentUrl = requireValidKdocsDocumentUrl(value);
          } else if (field.key.includes("WebhookUrl")) {
            nextSettings[field.key] = requireValidKdocsWebhookUrl(value);
          } else {
            nextSettings[field.key] = value;
          }
        }
      }
      this.ctx.services.updateProjectConfig((draftConfig) => {
        draftConfig.kdocsDataDetailSync = nextSettings;
      });
      this.state.message = "同步设置已保存。";
    }
  };
  return page;
}

module.exports = { createKdocsPage };
