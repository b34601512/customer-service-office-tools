// 汇总页：批量运行实时进度 + 每店状态着色 + 强制重采范围子菜单。
// 运行链路走 services.runTask（内部是 runConfiguredStoresTask 同一 stateStore 实例）。
const ansi = require("../ansi");
const { fit } = require("../width");
const { formatDurationMs, formatSummaryTaskStatus } = require("../format");
const { spinner, titleBanner, progressBar } = require("../gameUi");
const { PLATFORM_SCOPE_DEFINITIONS } = require("../../../shared/storeCollectionScope");

function formatStoreResultLine(storeResult, columns, isSelected) {
  const statusInfo = formatSummaryTaskStatus(storeResult.status);
  let text = `[${statusInfo.label}] ${storeResult.storeName}`;
  if (storeResult.status === "success") {
    text += ` · ${storeResult.metricCount} 项${storeResult.skippedCount ? ` · 跳过${storeResult.skippedCount}项` : ""}`;
  } else if (storeResult.status === "skipped") {
    text += ` · 今日已有 ${storeResult.previousMetricCount || 0} 项`;
  } else if (storeResult.status === "error" || storeResult.status === "running") {
    text += ` · ${storeResult.detail}`;
  }
  if (isSelected) {
    return ansi.colorize(fit(` ${text}`, columns), "reverse");
  }
  return fit(ansi.colorize(` ${text}`, statusInfo.color), columns, false);
}

function createTasksPage() {
  const page = {
    key: "2",
    title: "汇总",
    state: { selection: 0, scopeMode: null, scopeSelection: 0, message: "", busy: false, scrollOffset: 0 },

    async startRun(app, { forceRecollect = false, collectionScope } = {}) {
      if (this.state.busy) return;
      this.state.busy = true;
      this.state.message = "";
      app.requestRender();
      try {
        await app.ctx.services.runTask({ forceRecollect, collectionScope });
        this.state.message = "本轮汇总已结束。";
      } catch (error) {
        this.state.message = `汇总停止：${String(error?.message || error)}`;
      } finally {
        this.state.busy = false;
        app.requestRender();
      }
    },

    startForceRecollect(app) {
      this.state.scopeMode = "choose";
      this.state.scopeSelection = 0;
      app.requestRender();
    },

    getScopeOptionCount(app) {
      if (this.state.scopeMode === "choose") return 3;
      if (this.state.scopeMode === "platform") return PLATFORM_SCOPE_DEFINITIONS.length;
      if (this.state.scopeMode === "store") return app.ctx.services.listEnabledStores().length;
      return 0;
    },

    renderScopeSubmenu(app) {
      const state = this.state;
      const lines = [];
      if (state.scopeMode === "choose") {
        const options = ["全部店铺", "某个平台", "某一家店"];
        lines.push(...titleBanner("◆ 强制重新采集范围 ◆", app.columns - 2));
        options.forEach((label, index) => {
          const row = ` ${index === state.scopeSelection ? "▶" : " "} ${label}`;
          lines.push(index === state.scopeSelection ? ansi.colorize(fit(row, app.columns), "reverse") : row);
        });
      } else if (state.scopeMode === "platform") {
        lines.push(...titleBanner("◆ 选择平台 ◆", app.columns - 2));
        PLATFORM_SCOPE_DEFINITIONS.forEach((definition, index) => {
          const row = ` ${index === state.scopeSelection ? "▶" : " "} ${definition.platformName}`;
          lines.push(index === state.scopeSelection ? ansi.colorize(fit(row, app.columns), "reverse") : row);
        });
      } else if (state.scopeMode === "store") {
        const stores = app.ctx.services.listEnabledStores();
        lines.push(...titleBanner("◆ 选择店铺 ◆", app.columns - 2));
        stores.forEach((store, index) => {
          const row = ` ${index === state.scopeSelection ? "▶" : " "} ${store.displayName}  编号=${store.key}`;
          lines.push(index === state.scopeSelection ? ansi.colorize(fit(row, app.columns), "reverse") : row);
        });
        if (!stores.length) {
          lines.push(ansi.colorize(" 没有启用的店铺，请先在店铺管理中启用至少一家店。", "yellow"));
        }
      }
      lines.push("");
      lines.push(ansi.colorize(" Esc 取消", "gray"));
      return lines;
    },

    render(app) {
      const state = app.ctx.services.getState();
      const columns = app.columns;
      const lines = [];

      if (this.state.scopeMode) {
        return this.renderScopeSubmenu(app);
      }

      lines.push(...titleBanner("◆ 店铺指标批量汇总 ◆", columns - 2));

      const running = state.status === "running";
      const hasRun = state.status !== "idle";
      const statusText = running ? "[运行中]" : hasRun ? "[已结束]" : "[未开始]";
      const statusColor = running ? "brightYellow" : hasRun ? "gray" : "gray";
      let statusLine = ` ${ansi.colorize(statusText, statusColor)}`;
      if (running) {
        statusLine += ` ${spinner(Math.floor(Date.now() / 1000))}`;
        if (state.startedAt) {
          statusLine += `  已运行 ${formatDurationMs(Date.now() - new Date(state.startedAt).getTime())}`;
        }
      }
      lines.push(statusLine);

      const storeResults = state.storeResults || [];
      const total = storeResults.length;
      const successCount = storeResults.filter((result) => result.status === "success").length;
      const errorCount = storeResults.filter((result) => result.status === "error").length;
      const skippedCount = storeResults.filter((result) => result.status === "skipped").length;
      const runningCount = storeResults.filter((result) => result.status === "running").length;
      if (total) {
        const done = successCount + errorCount + skippedCount;
        lines.push(` 进度  ${progressBar(done, total, columns - 8, running ? "brightYellow" : "brightGreen")}`);
      }
      lines.push(` 完成 ${successCount}  跳过 ${skippedCount}  失败 ${errorCount}${runningCount ? `  运行中 ${runningCount}` : ""}`);

      if (total) {
        const contentHeight = app.contentHeight;
        const maxVisible = Math.max(3, contentHeight - 9);
        const selection = Math.min(Math.max(0, this.state.selection), total - 1);
        let scrollOffset = this.state.scrollOffset;
        if (selection < scrollOffset) scrollOffset = selection;
        if (selection >= scrollOffset + maxVisible) scrollOffset = selection - maxVisible + 1;
        this.state.scrollOffset = scrollOffset;
        this.state.selection = selection;
        const visible = storeResults.slice(scrollOffset, scrollOffset + maxVisible);
        visible.forEach((storeResult, index) => {
          const isSelected = scrollOffset + index === selection;
          lines.push(formatStoreResultLine(storeResult, columns, isSelected));
        });
        if (total > maxVisible) {
          lines.push(ansi.colorize(` ↑↓ 浏览（${scrollOffset + 1}-${Math.min(scrollOffset + maxVisible, total)}/${total}）`, "gray"));
        }
      } else {
        lines.push(ansi.colorize(" 尚无运行记录，按 S 开始汇总。", "gray"));
      }

      if (hasRun && state.detail) {
        const finished = state.status === "success";
        const hasFailures = state.status === "error" || state.status === "partial_error";
        const detailColor = finished ? "brightGreen" : hasFailures ? "brightRed" : "gray";
        lines.push(ansi.colorize(` ${state.detail}`, detailColor));
      }
      if (this.state.message) {
        lines.push(ansi.colorize(` ${this.state.message}`, "brightYellow"));
      }
      return lines;
    },

    footer(app) {
      return this.state.scopeMode
        ? "↑↓选择 回车确认  Esc 取消"
        : "S 开始汇总  F 强制重新采集  回车=单店强制重采  ↑↓选择";
    },

    handleKey(key, app) {
      const state = this.state;
      if (state.scopeMode) {
        return this.handleScopeKey(key, app);
      }
      const storeResults = app.ctx.services.getState().storeResults || [];
      if (key === "up") {
        const resultCount = Math.max(1, storeResults.length);
        state.selection = (state.selection - 1 + resultCount) % resultCount;
        return true;
      }
      if (key === "down") {
        const resultCount = Math.max(1, storeResults.length);
        state.selection = (state.selection + 1) % resultCount;
        return true;
      }
      if (key === "s" || key === "S") {
        this.startRun(app, { forceRecollect: false, collectionScope: { type: "all" } });
        return true;
      }
      if (key === "f" || key === "F") {
        this.startForceRecollect(app);
        return true;
      }
      if (key === "enter") {
        const selected = storeResults[state.selection];
        if (selected) {
          this.startRun(app, {
            forceRecollect: true,
            collectionScope: {
              type: "store",
              platformKey: selected.platformKey,
              storeKey: selected.storeKey
            }
          });
        }
        return true;
      }
      if (key === "esc" || key === "backspace") {
        state.selection = 0;
        return true;
      }
      return false;
    },

    handleScopeKey(key, app) {
      const state = this.state;
      if (key === "esc" || key === "backspace") {
        state.scopeMode = null;
        return true;
      }
      if (key === "up") {
        const optionCount = Math.max(1, this.getScopeOptionCount(app));
        state.scopeSelection = (state.scopeSelection - 1 + optionCount) % optionCount;
        return true;
      }
      if (key === "down") {
        const optionCount = Math.max(1, this.getScopeOptionCount(app));
        state.scopeSelection = (state.scopeSelection + 1) % optionCount;
        return true;
      }
      if (key === "enter") {
        if (state.scopeMode === "choose") {
          if (state.scopeSelection === 0) {
            state.scopeMode = null;
            this.startRun(app, { forceRecollect: true, collectionScope: { type: "all" } });
          } else if (state.scopeSelection === 1) {
            state.scopeMode = "platform";
            state.scopeSelection = 0;
          } else {
            state.scopeMode = "store";
            state.scopeSelection = 0;
          }
          return true;
        }
        if (state.scopeMode === "platform") {
          const platform = PLATFORM_SCOPE_DEFINITIONS[state.scopeSelection];
          if (platform) {
            state.scopeMode = null;
            this.startRun(app, {
              forceRecollect: true,
              collectionScope: { type: "platform", platformKey: platform.platformKey }
            });
          }
          return true;
        }
        if (state.scopeMode === "store") {
          const stores = app.ctx.services.listEnabledStores();
          const selected = stores[state.scopeSelection];
          if (selected) {
            state.scopeMode = null;
            this.startRun(app, {
              forceRecollect: true,
              collectionScope: {
                type: "store",
                platformKey: selected.platformKey,
                storeKey: selected.key
              }
            });
          }
          return true;
        }
      }
      return true;
    }
  };
  return page;
}

module.exports = {
  createTasksPage,
  formatStoreResultLine
};