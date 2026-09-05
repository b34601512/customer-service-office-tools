// 店铺管理页：平台列表 → 店铺列表 → 店铺详情/客服指标，多级导航。
// 文本编辑统一走 TUI 模态输入框（回车确认 Esc 取消）。
const ansi = require("../ansi");
const { fit, padEnd, normalizeCellText } = require("../width");
const { PLATFORM_META } = require("../../cliConstants");
const { PLATFORM_KEYS, addPlatformStore, patchPlatformStore, patchReportProfile,
  applyStoreCustomDateRange, restoreStoreGlobalDateRange, normalizeUserPath } = require("../../cliProjectConfig");
const { listReportModules } = require("../../../config/reportModuleDefinitions");
const { selectionViewport } = require("../selectionViewport");

function isValidCalendarDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) return false;
  const [year, month, day] = dateText.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);
  return parsedDate.getFullYear() === year && parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day;
}

function buildStoreActions(store, platformKey) {
  return [
    { id: "toggle", label: store.includedInSummary !== false ? "停用本店汇总" : "启用本店汇总", hint: "" },
    { id: "name", label: "编辑店铺名称", hint: store.displayName },
    { id: "username", label: "编辑登录账号", hint: store.username || "未配置" },
    { id: "password", label: "编辑登录密码", hint: store.password ? "********（已配置）" : "未配置", secret: true },
    { id: "date", label: "统计日期", hint: store.usesGlobalExportDateRange !== false ? "跟随全局" : "单店自定义" },
    { id: "reports", label: "客服指标开关", hint: "" },
    { id: "downloadDir", label: "编辑下载目录", hint: store.downloadDir },
    ...(platformStoreExtraFields(store, platformKey))
  ];
}

function platformStoreExtraFields(store, platformKey) {
  if (platformKey === "pdd") {
    return [{ id: "pddIdentity", label: "编辑真实店铺名称", hint: store?.expectedIdentityText || "未配置（按账号识别）" }];
  }
  if (platformKey === "jd") {
    return [{ id: "jdScope", label: "编辑客服筛选范围", hint: `${store?.customerServiceScope?.mode || "客服岗位"}：${(store?.customerServiceScope?.values || []).join("、")}` }];
  }
  // 抖音店铺额外支持抖店ID/名称编辑。
  if (platformKey === "douyin") {
    return [
      { id: "douyinId", label: "编辑抖店ID", hint: store?.platformStoreId || "未配置" },
      { id: "douyinName", label: "编辑抖店名称", hint: store?.platformStoreName || "未配置" }
    ];
  }
  return [];
}

function createStorePage() {
  const page = {
    key: "3",
    title: "店铺",
    // mode: platforms → stores → store → reports
    state: { mode: "platforms", platformKey: null, storeKey: null, selection: 0, storeSelection: 0, reportSelection: 0, message: "" },
    onEnter() {
      this.state.message = "";
    },
    currentStores() {
      const config = this.ctx.services.readConfig();
      return config?.[this.state.platformKey]?.stores || [];
    },
    render(app) {
      const columns = app.columns;
      const lines = [];
      if (this.state.mode === "platforms") {
        lines.push(ansi.colorize("平台列表（回车进入店铺，A新增店铺请先进入平台）", "brightBlue"));
        const config = app.ctx.services.readConfig();
        PLATFORM_KEYS.forEach((platformKey, index) => {
          const stores = config?.[platformKey]?.stores || [];
          const enabledCount = stores.filter((store) => store.includedInSummary !== false).length;
          const selected = index === this.state.selection;
          const line = `${selected ? "▶ " : "  "}${padEnd(PLATFORM_META[platformKey].label, 8)}${enabledCount}/${stores.length} 家启用`;
          lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        });
      } else if (this.state.mode === "stores") {
        const stores = this.currentStores();
        lines.push(ansi.colorize(`${PLATFORM_META[this.state.platformKey].label}店铺（回车进入详情 A新增）`, "brightBlue"));
        stores.forEach((store, index) => {
          const selected = index === this.state.selection;
          const statusText = store.includedInSummary !== false ? ansi.colorize("启用", "brightGreen") : ansi.colorize("停用", "gray");
          const credentialText = store.username && store.password ? "凭证已配置" : ansi.colorize("凭证未完整", "yellow");
          const line = `${selected ? "▶ " : "  "}${padEnd(normalizeCellText(store.displayName), 18)}${statusText}  ${credentialText}`;
          lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        });
      } else if (this.state.mode === "store") {
        const store = this.findCurrentStore();
        if (!store) {
          lines.push(ansi.colorize("店铺不存在，按 Esc 返回。", "brightRed"));
        } else {
          lines.push(ansi.colorize(`${PLATFORM_META[this.state.platformKey].label} · ${store.displayName}`, "brightBlue"));
          const enabledReportCount = Object.values(store.reportProfiles || {}).filter((profile) => profile.enabled !== false).length;
          lines.push(`编号 ${store.key}   汇总${store.includedInSummary !== false ? "启用" : "停用"}   指标 ${enabledReportCount} 项`);
          lines.push(`日期 ${store.usesGlobalExportDateRange !== false ? "跟随全局" : "单店自定义"} · ${store.exportDateRange.start.customDate} 至 ${store.exportDateRange.end.customDate}`);
          lines.push(ansi.colorize("─".repeat(Math.min(columns, 72)), "gray"));
          const actions = buildStoreActions(store, this.state.platformKey);
          if (this.state.storeSelection >= actions.length) this.state.storeSelection = 0;
          actions.forEach((action, index) => {
            const selected = index === this.state.storeSelection;
            const line = `${selected ? "▶ " : "  "}${padEnd(normalizeCellText(action.label), 18)}${ansi.colorize(normalizeCellText(action.hint || ""), "gray")}`;
            lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
          });
        }
      } else if (this.state.mode === "reports") {
        const store = this.findCurrentStore();
        const reports = listReportModules().filter((moduleItem) => store?.reportProfiles?.[moduleItem.key]);
        lines.push(ansi.colorize(`${store?.displayName} · 客服指标（回车切换启用状态）`, "brightBlue"));
        if (this.state.reportSelection >= reports.length) this.state.reportSelection = 0;
        reports.forEach((moduleItem, index) => {
          const profile = store.reportProfiles[moduleItem.key];
          const selected = index === this.state.reportSelection;
          const statusText = profile.enabled !== false ? ansi.colorize("启用", "brightGreen") : ansi.colorize("停用", "gray");
          const line = `${selected ? "▶ " : "  "}${padEnd(normalizeCellText(moduleItem.displayName), 20)}${statusText}`;
          lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        });
      }

      lines.push("");
      if (this.state.message) {
        lines.push(ansi.colorize(`提示：${this.state.message}`, "brightYellow"));
      } else {
        lines.push(ansi.colorize("Esc/q 返回上一级", "gray"));
      }
      const selectedLine = this.state.mode === "store" ? 4 + this.state.storeSelection
        : this.state.mode === "reports" ? 1 + this.state.reportSelection : 1 + this.state.selection;
      return selectionViewport(lines, selectedLine, app.contentHeight, 1, 1);
    },
    footer() {
      if (this.state.mode === "store") {
        return "↑↓选择 回车执行 Esc返回店铺列表 | ←→切页 Ctrl+C退出";
      }
      if (this.state.mode === "reports") {
        return "↑↓选择 回车切换启用 Esc返回店铺详情";
      }
      return "↑↓选择 回车进入 A新增店铺(店铺列表) Esc返回 | ←→切页 Ctrl+C退出";
    },
    findCurrentStore() {
      const config = this.ctx.services.readConfig();
      return (config?.[this.state.platformKey]?.stores || []).find((store) => store.key === this.state.storeKey);
    },
    handleKey(key, app) {
      this.state.message = "";
      if (key === "esc" || key === "q" || key === "backspace") {
        if (this.state.mode === "stores") {
          this.state.mode = "platforms";
          this.state.selection = PLATFORM_KEYS.indexOf(this.state.platformKey);
        } else if (this.state.mode === "store") {
          this.state.mode = "stores";
        } else if (this.state.mode === "reports") {
          this.state.mode = "store";
        }
        return true;
      }
      if (this.state.mode === "platforms") {
        if (key === "up") { this.state.selection = Math.max(0, this.state.selection - 1); return true; }
        if (key === "down") { this.state.selection = Math.min(PLATFORM_KEYS.length - 1, this.state.selection + 1); return true; }
        if (key === "enter") {
          this.state.platformKey = PLATFORM_KEYS[this.state.selection];
          this.state.mode = "stores";
          this.state.selection = 0;
          return true;
        }
        return false;
      }
      if (this.state.mode === "stores") {
        const stores = this.currentStores();
        if (key === "up") { this.state.selection = Math.max(0, this.state.selection - 1); return true; }
        if (key === "down") { this.state.selection = Math.min(stores.length - 1, this.state.selection + 1); return true; }
        if (key === "a" || key === "A") {
          try {
            const { newStoreKey } = addPlatformStore(this.state.platformKey);
            this.state.storeKey = newStoreKey;
            this.state.mode = "store";
            this.state.storeSelection = 0;
            this.state.message = "已按模板新增店铺，请补全名称与登录凭证。";
          } catch (error) {
            this.state.message = error instanceof Error ? error.message : String(error);
          }
          return true;
        }
        if (key === "enter" && stores.length) {
          this.state.storeKey = stores[this.state.selection]?.key;
          this.state.mode = "store";
          this.state.storeSelection = 0;
          return true;
        }
        return false;
      }
      if (this.state.mode === "store") {
        const store = this.findCurrentStore();
        const actions = buildStoreActions(store || {}, this.state.platformKey);
        if (key === "up") { this.state.storeSelection = Math.max(0, this.state.storeSelection - 1); return true; }
        if (key === "down") { this.state.storeSelection = Math.min(actions.length - 1, this.state.storeSelection + 1); return true; }
        if (key === "enter") {
          this.executeStoreAction(actions[this.state.storeSelection], app, store);
          return true;
        }
        return false;
      }
      if (this.state.mode === "reports") {
        const store = this.findCurrentStore();
        const reports = listReportModules().filter((moduleItem) => store?.reportProfiles?.[moduleItem.key]);
        if (key === "up") { this.state.reportSelection = Math.max(0, this.state.reportSelection - 1); return true; }
        if (key === "down") { this.state.reportSelection = Math.min(reports.length - 1, this.state.reportSelection + 1); return true; }
        if (key === "enter" && reports.length) {
          const moduleItem = reports[this.state.reportSelection];
          const profile = store.reportProfiles[moduleItem.key];
          patchReportProfile(this.state.platformKey, this.state.storeKey, moduleItem.key, { enabled: profile.enabled === false });
          return true;
        }
        return false;
      }
      return false;
    },
    async executeStoreAction(action, app, store) {
      if (!action || !store) return;
      const platformKey = this.state.platformKey;
      const storeKey = this.state.storeKey;
      try {
        if (action.id === "toggle") {
          patchPlatformStore(platformKey, storeKey, { includedInSummary: store.includedInSummary === false });
          this.state.message = store.includedInSummary !== false ? "已停用本店汇总。" : "已启用本店汇总。";
          return;
        }
        if (action.id === "name") {
          const value = await app.requestInput({ title: `新店铺名称（当前 ${store.displayName}）` });
          if (value === null) return;
          if (value) patchPlatformStore(platformKey, storeKey, { displayName: value });
          this.state.message = "店铺名称已保存。";
          return;
        }
        if (action.id === "username") {
          const value = await app.requestInput({ title: `登录账号（当前 ${store.username || "未配置"}）` });
          if (value === null) return;
          if (value) patchPlatformStore(platformKey, storeKey, { username: value });
          this.state.message = "登录账号已保存。";
          return;
        }
        if (action.id === "password") {
          const value = await app.requestInput({ title: "登录密码（输入即覆盖）", secret: true });
          if (value === null) return;
          if (value) patchPlatformStore(platformKey, storeKey, { password: value });
          this.state.message = "登录密码已保存。";
          return;
        }
        if (action.id === "douyinId") {
          const value = await app.requestInput({ title: `抖店ID（当前 ${store.platformStoreId || "未配置"}）` });
          if (value === null) return;
          patchPlatformStore(platformKey, storeKey, { platformStoreId: value });
          this.state.message = "抖店ID已保存。";
          return;
        }
        if (action.id === "jdScope") {
          const scope = store.customerServiceScope || { mode: "客服岗位", values: ["售前"] };
          const modeAnswer = await app.requestInput({ title: "客服筛选类型：1=客服岗位 2=客服组", defaultValue: scope.mode === "客服组" ? "2" : "1" });
          if (modeAnswer === null) return;
          if (!["1", "2"].includes(modeAnswer)) throw new Error("筛选类型必须是 1 或 2。");
          const names = await app.requestInput({ title: "岗位或客服组名称（逗号分隔，须与后台一致）", defaultValue: scope.values.join("，") });
          if (names === null) return;
          patchPlatformStore(platformKey, storeKey, { customerServiceScope: {
            mode: modeAnswer === "1" ? "客服岗位" : "客服组",
            values: names.split(/[，,]/).map((name) => name.trim()).filter(Boolean)
          } });
          this.state.message = "客服筛选范围已保存。";
          return;
        }
        if (action.id === "pddIdentity") {
          const value = await app.requestInput({ title: "拼多多后台显示的真实店铺名称", defaultValue: store.expectedIdentityText || "" });
          if (value === null) return;
          patchPlatformStore(platformKey, storeKey, { expectedIdentityText: value });
          this.state.message = "真实店铺名称已保存，下载前将核对店铺身份。";
          return;
        }
        if (action.id === "douyinName") {
          const value = await app.requestInput({ title: `抖店名称（当前 ${store.platformStoreName || "未配置"}）` });
          if (value === null) return;
          patchPlatformStore(platformKey, storeKey, { platformStoreName: value });
          this.state.message = "抖店名称已保存。";
          return;
        }
        if (action.id === "date") {
          if (store.usesGlobalExportDateRange !== false) {
            const confirmed = await app.requestConfirm("本店当前跟随全局日期，改为单店自定义？(n=保持跟随)");
            if (!confirmed) return;
            const startDate = await app.requestInput({ title: "开始日期 YYYY-MM-DD" });
            if (!startDate || !isValidCalendarDate(startDate)) throw new Error("开始日期无效。");
            const endDate = await app.requestInput({ title: "结束日期 YYYY-MM-DD" });
            if (!endDate || !isValidCalendarDate(endDate)) throw new Error("结束日期无效。");
            if (startDate > endDate) throw new Error("开始日期不能晚于结束日期。");
            applyStoreCustomDateRange(platformKey, storeKey, startDate, endDate);
            this.state.message = "已设置单店自定义日期。";
          } else {
            restoreStoreGlobalDateRange(platformKey, storeKey);
            this.state.message = "已恢复跟随全局日期。";
          }
          return;
        }
        if (action.id === "reports") {
          this.state.mode = "reports";
          this.state.reportSelection = 0;
          return;
        }
        if (action.id === "downloadDir") {
          const value = await app.requestInput({ title: `下载目录（当前 ${store.downloadDir}）` });
          if (value === null) return;
          if (value) {
            patchPlatformStore(platformKey, storeKey, { downloadDir: normalizeUserPath(value) });
            this.state.message = "下载目录已保存。";
          }
          return;
        }
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      } finally {
        app.requestRender();
      }
    }
  };
  return page;
}

module.exports = { createStorePage, isValidCalendarDate };
