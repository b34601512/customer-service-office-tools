// 客服绩效 TUI：只展示新事实账本，所有柱状图均按“越少越好”解释。
const ansi = require("../ansi");
const { fit, normalizeCellText, padStart } = require("../width");
const {
  SORT_COUNT,
  SORT_TOTAL,
  buildRangeOptions,
  buildTimeoutPerformanceReport
} = require("../../../features/timeoutPerformance/timeoutPerformanceMetrics");

const SORT_OPTIONS = [
  { key: SORT_COUNT, label: "超时次数↓", valueLabel: "次数" },
  { key: SORT_TOTAL, label: "累计超时↓", valueLabel: "累计" }
];

function formatDurationSeconds(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  if (totalSeconds === 0) {
    return "0秒";
  }
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours === 0) {
    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatTrustedStart(timestampMs) {
  if (!Number(timestampMs || 0)) {
    return "待后台首次采集";
  }
  return new Date(Number(timestampMs)).toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-");
}

function resolveSortOption(sortKey) {
  return SORT_OPTIONS.find((item) => item.key === sortKey) || SORT_OPTIONS[0];
}

function resolveMetricValue(row, sortKey) {
  if (sortKey === SORT_TOTAL) {
    return row.totalOverdueSeconds;
  }
  return row.timeoutCount;
}

function formatMetricValue(row, sortKey) {
  if (sortKey === SORT_COUNT) {
    return `${row.timeoutCount}次`;
  }
  return formatDurationSeconds(resolveMetricValue(row, sortKey));
}

function buildBar(row, sortKey, maxValue, width) {
  if (row.timeoutCount === 0) {
    return ansi.colorize(fit("无超时", width), "brightGreen");
  }
  const value = resolveMetricValue(row, sortKey);
  const filledWidth = Math.max(1, Math.round((value / Math.max(1, maxValue)) * width));
  const bar = "█".repeat(Math.min(width, filledWidth));
  return ansi.colorize(fit(bar, width), value === maxValue ? "brightRed" : "brightYellow");
}

function buildWideHeader(columns) {
  const fixedWidth = 75;
  const barWidth = Math.max(8, columns - fixedWidth);
  return {
    barWidth,
    line: `${fit("排名", 4)} ${fit("客服", 18)} ${padStart("次数", 8)} ${padStart("累计超时", 12)} ${padStart("未解决", 6)} ${fit("对比柱", barWidth)}`
  };
}

function buildWideRow(row, index, sortKey, maxValue, columns) {
  const { barWidth } = buildWideHeader(columns);
  const name = normalizeCellText(row.assigneeName);
  return (
    `${fit(String(index + 1), 4)} ${fit(name, 18)} ${padStart(String(row.timeoutCount), 8)} ` +
    `${padStart(formatDurationSeconds(row.totalOverdueSeconds), 12)} ` +
    `${padStart(String(row.activeTimeoutCount), 6)} ${buildBar(row, sortKey, maxValue, barWidth)}`
  );
}

function buildNarrowHeader(columns, sortOption) {
  const barWidth = Math.max(6, columns - 31);
  return {
    barWidth,
    line: `${fit("排名", 4)} ${fit("客服", 14)} ${padStart(sortOption.valueLabel, 10)} ${fit("对比柱", barWidth)}`
  };
}

function buildNarrowRow(row, index, sortKey, maxValue, columns) {
  const { barWidth } = buildNarrowHeader(columns, resolveSortOption(sortKey));
  return (
    `${fit(String(index + 1), 4)} ${fit(normalizeCellText(row.assigneeName), 14)} ` +
    `${padStart(formatMetricValue(row, sortKey), 10)} ${buildBar(row, sortKey, maxValue, barWidth)}`
  );
}

function reloadLedger(page, app) {
  page.state.ledger = app.ctx.services.readPerformanceLedger();
  page.state.rangeOptions = buildRangeOptions(page.state.ledger);
  if (!page.state.rangeOptions.some((item) => item.key === page.state.rangeKey)) {
    page.state.rangeKey = "recent30";
  }
  page.state.scrollOffset = 0;
  page.state.message = "";
}

function createReportsPage() {
  return {
    key: "7",
    title: "报表",
    state: {
      ledger: null,
      rangeKey: "recent30",
      rangeOptions: [],
      sortKey: SORT_COUNT,
      scrollOffset: 0,
      visibleRowCount: 1,
      totalRowCount: 0,
      message: ""
    },
    onEnter(app) {
      try {
        reloadLedger(this, app);
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      }
    },
    render(app) {
      const columns = app.columns;
      const contentHeight = app.contentHeight;
      const lines = [];
      const ledger = this.state.ledger || { startedAtMs: 0, timeoutEvents: [], staffObservations: [] };
      const report = buildTimeoutPerformanceReport(ledger, {
        rangeKey: this.state.rangeKey,
        sortKey: this.state.sortKey,
        nowMs: Date.now()
      });
      const sortOption = resolveSortOption(report.sortKey);

      lines.push(ansi.colorize(fit(`客服绩效对比  范围：${report.range.label}  排序：${sortOption.label}（越少越好）`, columns), "brightBlue"));
      lines.push(fit(`可信数据起点：${formatTrustedStart(report.trustedStartedAtMs)}  客服 ${report.summary.staffCount}  个人超时 ${report.summary.timeoutCount}  未分配 ${report.summary.unassignedTimeoutCount}  映射缺失 ${report.summary.memberMappingMissingTimeoutCount}`, columns));
      lines.push(ansi.colorize(fit(`个人累计 ${formatDurationSeconds(report.summary.totalOverdueSeconds)}  未解决 ${report.summary.activeTimeoutCount}；累计按单次漏回复阈值封顶。`, columns), "gray"));
      lines.push("");

      const wide = columns >= 96;
      const header = wide ? buildWideHeader(columns) : buildNarrowHeader(columns, sortOption);
      lines.push(ansi.colorize(fit(header.line, columns), "brightCyan"));

      const visibleRowCount = Math.max(1, contentHeight - lines.length - (this.state.message ? 2 : 0));
      this.state.visibleRowCount = visibleRowCount;
      this.state.totalRowCount = report.rows.length;
      const maxOffset = Math.max(0, report.rows.length - visibleRowCount);
      this.state.scrollOffset = Math.min(this.state.scrollOffset, maxOffset);
      const visibleRows = report.rows.slice(this.state.scrollOffset, this.state.scrollOffset + visibleRowCount);
      const maxValue = Math.max(0, ...report.rows.map((row) => resolveMetricValue(row, report.sortKey)));

      if (visibleRows.length === 0) {
        lines.push(ansi.colorize(fit("暂无新版本数据。后台首次采集后，会显示客服对比。", columns), "gray"));
      } else {
        visibleRows.forEach((row, visibleIndex) => {
          const rowIndex = this.state.scrollOffset + visibleIndex;
          const line = wide
            ? buildWideRow(row, rowIndex, report.sortKey, maxValue, columns)
            : buildNarrowRow(row, rowIndex, report.sortKey, maxValue, columns);
          lines.push(fit(line, columns));
        });
      }

      if (this.state.message) {
        lines.push("");
        lines.push(ansi.colorize(fit(`提示：${this.state.message}`, columns), "brightYellow"));
      }
      return lines;
    },
    footer() {
      return "[ ]切范围 s切排序 ↑↓滚动 r刷新 ←→切页 q返回总览";
    },
    handleKey(key, app) {
      if (key === "r") {
        try {
          reloadLedger(this, app);
          this.state.message = "已刷新绩效账本。";
        } catch (error) {
          this.state.message = error instanceof Error ? error.message : String(error);
        }
        return true;
      }
      if (key === "[") {
        const currentIndex = Math.max(0, this.state.rangeOptions.findIndex((item) => item.key === this.state.rangeKey));
        const nextIndex = (currentIndex - 1 + this.state.rangeOptions.length) % this.state.rangeOptions.length;
        this.state.rangeKey = this.state.rangeOptions[nextIndex]?.key || "recent30";
        this.state.scrollOffset = 0;
        return true;
      }
      if (key === "]") {
        const currentIndex = Math.max(0, this.state.rangeOptions.findIndex((item) => item.key === this.state.rangeKey));
        const nextIndex = (currentIndex + 1) % this.state.rangeOptions.length;
        this.state.rangeKey = this.state.rangeOptions[nextIndex]?.key || "recent30";
        this.state.scrollOffset = 0;
        return true;
      }
      if (key === "s") {
        const currentIndex = SORT_OPTIONS.findIndex((item) => item.key === this.state.sortKey);
        this.state.sortKey = SORT_OPTIONS[(currentIndex + 1) % SORT_OPTIONS.length].key;
        this.state.scrollOffset = 0;
        return true;
      }
      if (key === "up") {
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
        return true;
      }
      if (key === "down") {
        const maxOffset = Math.max(0, this.state.totalRowCount - this.state.visibleRowCount);
        this.state.scrollOffset = Math.min(maxOffset, this.state.scrollOffset + 1);
        return true;
      }
      return false;
    }
  };
}

module.exports = {
  createReportsPage,
  formatDurationSeconds
};
