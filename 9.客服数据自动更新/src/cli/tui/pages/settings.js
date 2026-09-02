// 设置页：全局日期方式、汇总表路径、下载根目录、客服设置与已有明细岗位更新。
const fs = require("fs");
const path = require("path");
const ansi = require("../ansi");
const { fit, padEnd, normalizeCellText } = require("../width");
const { formatGlobalDateMode } = require("../../cliDashboard");
const { createManualExportDateRangeConfig } = require("../../../shared/exportDateRange");
const { readProjectConfig, saveProjectConfig } = require("../../../config/projectConfigServiceParts/projectConfigPersistence");
const { updateProjectConfig, normalizeUserPath } = require("../../cliProjectConfig");

function isValidCalendarDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) return false;
  const [year, month, day] = dateText.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);
  return parsedDate.getFullYear() === year && parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day;
}

function parseSourceNames(sourceNamesText) {
  return [...new Set(String(sourceNamesText || "").split(/[，,]/).map((item) => item.trim()).filter(Boolean))];
}

function buildFieldRows(projectConfig) {
  const defaults = projectConfig?.globalDefaults || {};
  const manualMode = defaults.exportDateMode === "manual";
  return [
    { id: "dateMode", label: "日期方式", value: manualMode ? "手动" : "智能（本月1号起自动）", hint: "回车切换；切换会覆盖全部店铺" },
    { id: "delayDays", label: "数据延迟天数", value: String(defaults.exportDateAutomation?.endDateDelayDayCount ?? 2), hint: "智能模式：结束日=今天-延迟" },
    ...(manualMode ? [
      { id: "manualStart", label: "手动开始日期", value: defaults.exportDateRange?.start?.customDate || "未设置" },
      { id: "manualEnd", label: "手动结束日期", value: defaults.exportDateRange?.end?.customDate || "未设置" }
    ] : []),
    { id: "workbookPath", label: "汇总表路径", value: projectConfig?.workbook?.path || "未设置" },
    { id: "downloadRoot", label: "下载根目录", value: defaults.downloadRootDir || "未设置", hint: "回车修改，会同步全部店铺" },
    { id: "personMappings", label: "客服设置", value: `${(defaults.reportProfiles?.performance?.personMappings || []).length} 名客服`, hint: "回车进入客服名单编辑" },
    { id: "refreshRoles", label: "更新已有明细岗位", value: "", hint: "按当前客服设置刷新汇总表售前/售后", action: true },
    { id: "openWorkbookDirectory", label: "打开汇总文件夹", value: "", action: true },
    { id: "openSummaryEvidenceDirectory", label: "打开凭证文件夹", value: "", action: true },
    { id: "openDownloadRootDirectory", label: "打开下载根目录", value: "", action: true }
  ];
}

function createSettingsPage() {
  const page = {
    key: "4",
    title: "设置",
    state: { selection: 0, message: "", busyText: "", personEditor: null },
    onEnter() {
      this.state.message = "";
    },
    render(app) {
      const columns = app.columns;
      const lines = [];
      if (this.state.personEditor) {
        return this.renderPersonEditor(app, lines, columns);
      }
      const projectConfig = this.ctx.services.readConfig();
      lines.push(ansi.colorize("全局设置（↑↓选择 回车编辑）", "brightBlue"));
      lines.push(`当前日期方式：${formatGlobalDateMode(projectConfig)}`);
      lines.push(ansi.colorize("─".repeat(Math.min(columns, 72)), "gray"));
      const rows = buildFieldRows(projectConfig);
      if (this.state.selection >= rows.length) this.state.selection = 0;
      rows.forEach((row, index) => {
        const selected = index === this.state.selection;
        const valueText = row.action ? "" : `  ${normalizeCellText(row.value)}`;
        const hintText = row.hint ? ansi.colorize(`  ${normalizeCellText(row.hint)}`, "gray") : "";
        const line = `${selected ? "▶ " : "  "}${padEnd(row.label, 14)}${fit(valueText, Math.max(10, columns - 40))}${hintText}`;
        lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
      });
      lines.push("");
      if (this.state.busyText) {
        lines.push(ansi.colorize(`⏳ ${this.state.busyText}`, "brightYellow"));
      }
      if (this.state.message) {
        lines.push(ansi.colorize(`提示：${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    renderPersonEditor(app, lines, columns) {
      const editor = this.state.personEditor;
      lines.push(ansi.colorize(`客服设置（A新增 E编辑 D删除 Esc返回）共 ${editor.mappings.length} 名`, "brightBlue"));
      if (!editor.mappings.length) {
        lines.push("暂无客服姓名映射，按 A 新增。");
      }
      editor.mappings.forEach((mapping, index) => {
        const selected = index === editor.selection;
        const line = `${selected ? "▶ " : "  "}${padEnd(normalizeCellText(mapping.summaryName), 10)} ${padEnd(normalizeCellText(mapping.role || ""), 4)} ${normalizeCellText((mapping.sourceNames || []).join("、"))}`;
        lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
      });
      return lines;
    },
    footer() {
      if (this.state.personEditor) {
        return "A新增 E编辑 D删除 Esc返回设置 | ←→切页 Ctrl+C退出";
      }
      return "↑↓选择 回车编辑/执行 Esc返回 | ←→切页 Ctrl+C退出";
    },
    handleKey(key, app) {
      this.state.message = "";
      if (this.state.personEditor) {
        return this.handlePersonEditorKey(key, app);
      }
      const projectConfig = this.ctx.services.readConfig();
      const rows = buildFieldRows(projectConfig);
      if (key === "up") { this.state.selection = Math.max(0, this.state.selection - 1); return true; }
      if (key === "down") { this.state.selection = Math.min(rows.length - 1, this.state.selection + 1); return true; }
      if (key === "esc") { return true; }
      if (key === "enter") {
        this.executeFieldAction(rows[this.state.selection], app);
        return true;
      }
      return false;
    },
    async executeFieldAction(row, app) {
      if (!row) return;
      try {
        if (row.id === "dateMode") {
          const projectConfig = this.ctx.services.readConfig();
          const manualMode = projectConfig.globalDefaults.exportDateMode === "manual";
          if (!manualMode) {
            const startDate = await app.requestInput({ title: "切换为手动：开始日期 YYYY-MM-DD" });
            if (!startDate || !isValidCalendarDate(startDate)) throw new Error("开始日期无效，未修改。");
            const endDate = await app.requestInput({ title: "结束日期 YYYY-MM-DD" });
            if (!endDate || !isValidCalendarDate(endDate)) throw new Error("结束日期无效，未修改。");
            if (startDate > endDate) throw new Error("开始日期不能晚于结束日期。");
            projectConfig.globalDefaults.exportDateMode = "manual";
            projectConfig.globalDefaults.exportDateRange = createManualExportDateRangeConfig(startDate, endDate);
            saveProjectConfig(projectConfig, { applyGlobalExportDateRangeToAllStores: true, requestedGlobalExportDateMode: "manual" });
            this.state.message = "已切换为手动日期并应用到全部店铺。";
          } else {
            const confirmed = await app.requestConfirm("切换为智能日期？（每次启动自动更新为本月1号起）");
            if (!confirmed) return;
            projectConfig.globalDefaults.exportDateMode = "automatic";
            saveProjectConfig(projectConfig, { applyGlobalExportDateRangeToAllStores: true, requestedGlobalExportDateMode: "automatic" });
            this.state.message = "已切换为智能日期并应用到全部店铺。";
          }
          return;
        }
        if (row.id === "delayDays") {
          const projectConfig = this.ctx.services.readConfig();
          const current = projectConfig.globalDefaults.exportDateAutomation?.endDateDelayDayCount ?? 2;
          const value = await app.requestInput({ title: `数据延迟天数（当前 ${current}）`, defaultValue: String(current) });
          if (value === null) return;
          const delayDayCount = value ? Number(value) : current;
          if (!Number.isInteger(delayDayCount) || delayDayCount < 0 || delayDayCount > 90) throw new Error("延迟天数必须是 0 至 90 的整数。");
          updateProjectConfig((draftConfig) => {
            draftConfig.globalDefaults.exportDateMode = "automatic";
            draftConfig.globalDefaults.exportDateAutomation = { endDateDelayDayCount: delayDayCount };
          }, { applyGlobalExportDateRangeToAllStores: true, requestedGlobalExportDateMode: "automatic" });
          this.state.message = "延迟天数已保存（智能模式）。";
          return;
        }
        if (row.id === "manualStart" || row.id === "manualEnd") {
          const projectConfig = this.ctx.services.readConfig();
          const isStart = row.id === "manualStart";
          const value = await app.requestInput({ title: isStart ? "开始日期 YYYY-MM-DD" : "结束日期 YYYY-MM-DD" });
          if (value === null) return;
          if (!value || !isValidCalendarDate(value)) throw new Error("日期无效，未修改。");
          const range = projectConfig.globalDefaults.exportDateRange;
          const startDate = isStart ? value : range.start.customDate;
          const endDate = isStart ? range.end.customDate : value;
          if (startDate > endDate) throw new Error("开始日期不能晚于结束日期。");
          projectConfig.globalDefaults.exportDateRange = createManualExportDateRangeConfig(startDate, endDate);
          saveProjectConfig(projectConfig, { applyGlobalExportDateRangeToAllStores: true, requestedGlobalExportDateMode: "manual" });
          this.state.message = "手动日期已保存并应用到全部店铺。";
          return;
        }
        if (row.id === "workbookPath") {
          const value = await app.requestInput({ title: "新汇总表 .xlsx 完整路径（空=保留）" });
          if (value === null) return;
          if (!value) return;
          const workbookPath = normalizeUserPath(value);
          if (path.extname(workbookPath).toLowerCase() !== ".xlsx" || !fs.existsSync(workbookPath) || !fs.statSync(workbookPath).isFile()) {
            throw new Error(`请选择已存在的 .xlsx 汇总表：${workbookPath}`);
          }
          updateProjectConfig((draftConfig) => { draftConfig.workbook.path = workbookPath; });
          this.state.message = "汇总表路径已保存。";
          return;
        }
        if (row.id === "downloadRoot") {
          const value = await app.requestInput({ title: "新下载根目录（空=保留）" });
          if (value === null) return;
          if (!value) return;
          const projectConfig = this.ctx.services.readConfig();
          projectConfig.globalDefaults.downloadRootDir = normalizeUserPath(value);
          saveProjectConfig(projectConfig, { applyGlobalDownloadRootToAllStores: true });
          this.state.message = "下载根目录已保存并同步全部店铺。";
          return;
        }
        if (row.id === "personMappings") {
          const projectConfig = this.ctx.services.readConfig();
          this.state.personEditor = {
            mappings: projectConfig?.globalDefaults?.reportProfiles?.performance?.personMappings || [],
            selection: 0
          };
          return;
        }
        if (row.id === "refreshRoles") {
          const confirmed = await app.requestConfirm("按当前客服设置更新汇总表已有明细的岗位？（不修改指标）");
          if (!confirmed) return;
          this.state.busyText = "正在更新已有明细岗位……";
          app.requestRender();
          try {
            const result = await this.ctx.services.refreshExistingPersonRoles();
            this.state.message = `更新完成${result?.updatedRowCount !== undefined ? `：${result.updatedRowCount} 行` : ""}。`;
          } finally {
            this.state.busyText = "";
          }
          return;
        }
        const folderActions = {
          openWorkbookDirectory: {
            busyText: "正在打开汇总文件夹……",
            run: () => this.ctx.services.openWorkbookDirectory()
          },
          openSummaryEvidenceDirectory: {
            busyText: "正在打开凭证文件夹……",
            run: () => this.ctx.services.openSummaryEvidenceDirectory()
          },
          openDownloadRootDirectory: {
            busyText: "正在打开下载根目录……",
            run: () => this.ctx.services.openDownloadRootDirectory()
          }
        };
        const folderAction = folderActions[row.id];
        if (folderAction) {
          this.state.busyText = folderAction.busyText;
          app.requestRender();
          try {
            await folderAction.run();
            this.state.message = "文件夹已打开。";
          } finally {
            this.state.busyText = "";
          }
        }
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      } finally {
        app.requestRender();
      }
    },
    handlePersonEditorKey(key, app) {
      const editor = this.state.personEditor;
      if (key === "esc" || key === "q") {
        this.state.personEditor = null;
        return true;
      }
      if (key === "up") { editor.selection = Math.max(0, editor.selection - 1); return true; }
      if (key === "down") { editor.selection = Math.min(editor.mappings.length - 1, editor.selection + 1); return true; }
      if (key === "a" || key === "A") {
        this.editPersonMapping(app, -1);
        return true;
      }
      if (key === "e" || key === "E") {
        if (editor.mappings.length) this.editPersonMapping(app, editor.selection);
        return true;
      }
      if (key === "d" || key === "D") {
        if (!editor.mappings.length) return true;
        const mapping = editor.mappings[editor.selection];
        app.requestConfirm(`确认删除客服「${mapping.summaryName}」？`).then((confirmed) => {
          if (!confirmed) return;
          editor.mappings.splice(editor.selection, 1);
          editor.selection = Math.max(0, editor.selection - 1);
          this.savePersonMappings(editor.mappings);
          this.state.message = "已删除。";
          app.requestRender();
        });
        return true;
      }
      return false;
    },
    async editPersonMapping(app, index) {
      const editor = this.state.personEditor;
      const existing = index >= 0 ? editor.mappings[index] : {};
      try {
        const summaryName = await app.requestInput({ title: `汇总姓名（当前 ${existing.summaryName || "未设置"}）` });
        if (summaryName === null) return;
        if (!summaryName && !existing.summaryName) throw new Error("汇总姓名不能为空。");
        const roleAnswer = await app.requestInput({ title: "岗位：1=售前 2=售后", defaultValue: existing.role === "售后" ? "2" : "1" });
        if (roleAnswer === null) return;
        const role = roleAnswer === "2" ? "售后" : roleAnswer === "1" ? "售前" : "";
        if (!role) throw new Error("岗位必须是 1（售前）或 2（售后）。");
        const aliasesText = await app.requestInput({ title: `后台账号/别名（逗号分隔，当前 ${(existing.sourceNames || []).join("，") || "未设置"}）` });
        if (aliasesText === null) return;
        const sourceNames = aliasesText ? parseSourceNames(aliasesText) : existing.sourceNames || [];
        if (!sourceNames.length) throw new Error("至少需要一个后台账号或别名。");
        const nextMapping = {
          summaryName: summaryName || existing.summaryName,
          role,
          sourceNames
        };
        if (index >= 0) editor.mappings[index] = nextMapping;
        else editor.mappings.push(nextMapping);
        this.savePersonMappings(editor.mappings);
        this.state.message = index >= 0 ? "客服已更新。" : "客服已新增。";
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      }
      app.requestRender();
    },
    savePersonMappings(personMappings) {
      updateProjectConfig((draftConfig) => {
        draftConfig.globalDefaults.reportProfiles.performance.personMappings = personMappings;
      });
    }
  };
  return page;
}

module.exports = { createSettingsPage, isValidCalendarDate, parseSourceNames };
