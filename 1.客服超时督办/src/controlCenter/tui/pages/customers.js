// 客户倒计时页：按统一未回复引擎镜像展示客户状态表格，回车查看详情。
const ansi = require("../ansi");
const { fit, padEnd, normalizeCellText } = require("../width");
const { formatRemainingSeconds, formatDateTimeText } = require("../format");

function resolveRemainingText(item) {
  const timeoutRemaining = Number(item.timeoutReminderRemainingSeconds || 0);
  const missedRemaining = Number(item.missedReplyReminderRemainingSeconds || 0);
  if (timeoutRemaining > 0) {
    return `超时 ${formatRemainingSeconds(timeoutRemaining)}`;
  }
  if (missedRemaining > 0) {
    return `漏回复 ${formatRemainingSeconds(missedRemaining)}`;
  }
  return "";
}

function buildStatusText(item) {
  const tags = Array.isArray(item.statusTags) ? item.statusTags : [];
  return tags.map((tag) => tag?.label || "").filter(Boolean).join(" ");
}

// 以下 formatFreshnessClock/formatFreshnessAge 与 web/countdown/customerMirrorList.js:60-80 逐字镜像，修改时双侧同步（issue #552）。
function formatFreshnessClock(timestampMs) {
  const numericTimestampMs = Number(timestampMs || 0);
  if (!Number.isFinite(numericTimestampMs) || numericTimestampMs <= 0) {
    return "未扫描";
  }

  const date = new Date(numericTimestampMs);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatFreshnessAge(ageSeconds) {
  const numericAgeSeconds = Number(ageSeconds);
  if (!Number.isFinite(numericAgeSeconds) || numericAgeSeconds < 0) {
    return "暂无";
  }
  if (numericAgeSeconds < 60) {
    return `${Math.floor(numericAgeSeconds)} 秒前`;
  }
  return `${Math.floor(numericAgeSeconds / 60)} 分钟前`;
}

// 这里与 web/countdown/customerMirrorList.js 的 renderFreshnessSummaryColor 三色规则互为镜像：秒级绿/分钟黄/过期红，阈值60双侧同步（issue #552）。
function resolveFreshnessAgeColor(ageSeconds, stale) {
  // 这里按新鲜度给“X秒/分钟前”上色：秒级=绿(新鲜)，分钟级=黄(偏旧)，过期=红(与警告一致)。
  if (stale) {
    return "brightRed";
  }
  if (Number(ageSeconds) < 60) {
    return "brightGreen";
  }
  return "brightYellow";
}

function buildDataFreshnessLines(dataFreshness, columns) {
  const freshness = dataFreshness || {};
  const ageSeconds = Number(freshness.ageSeconds);
  // 时间与“X秒/分钟前”分段上色：fit 会先剥离 ANSI 码再算宽度，不会破坏对齐。
  const clockText = ansi.colorize(formatFreshnessClock(freshness.lastScannedAtMs), "brightBlue");
  const ageText = ansi.colorize(formatFreshnessAge(ageSeconds), resolveFreshnessAgeColor(ageSeconds, freshness.stale));
  const freshnessText = `数据最后扫描 ${clockText}（${ageText}）`;
  const lines = [fit(freshnessText, columns)];
  if (freshness.stale) {
    const staleMinutes = Math.max(1, Math.floor((Number.isFinite(ageSeconds) ? ageSeconds : 0) / 60));
    lines.push(ansi.colorize(
      fit(`⚠ 数据已 ${staleMinutes} 分钟未更新，后台扫描可能已停止/浏览器可能挂掉，按 3 看日志、回 1 重启任务`, columns),
      "brightRed"
    ));
  }
  return lines;
}

// 列宽常量：序号 4 + 客户 20 + 超时 12 + 漏回复 12 + 倒计时 12（最长“漏回复 00:00”=12格）+ 5 个分隔符。
const COLUMN_WIDTHS = {
  order: 4,
  customer: 20,
  timeout: 12,
  missed: 12,
  remaining: 12
};
const COLUMN_SEPARATORS = 5;

const TAG_COLOR_MAP = {
  danger: "brightRed",
  warning: "yellow",
  success: "brightGreen",
  neutral: "gray"
};

function colorizeTagLabel(label, type) {
  if (!label) {
    return "";
  }
  return ansi.colorize(normalizeCellText(label), TAG_COLOR_MAP[type] || "gray");
}

function splitStatusTags(item) {
  // 这里把状态标签拆成“超时/漏回复/其它”三列，避免多个状态糊在同一列里。
  // 注意“未进入超时/未进入漏回复”这类以“未”开头的标签也要归入对应列，
  // “最近X提醒”和“提醒后已恢复”这类复盘标签归入其它列，避免覆盖当前状态。
  const tags = Array.isArray(item.statusTags) ? item.statusTags : [];
  let timeoutTag = null;
  let missedReplyTag = null;
  const extraTags = [];
  for (const tag of tags) {
    const label = String(tag?.label || "");
    if (label.startsWith("最近")) {
      extraTags.push({ label, type: tag?.type });
    } else if (label.includes("超时")) {
      timeoutTag = { label, type: tag?.type };
    } else if (label.includes("漏回复")) {
      missedReplyTag = { label, type: tag?.type };
    } else {
      extraTags.push({ label, type: tag?.type });
    }
  }
  return { timeoutTag, missedReplyTag, extraTags };
}

function resolvePreviewWidth(columns) {
  return Math.max(
    8,
    columns -
      COLUMN_WIDTHS.order -
      COLUMN_WIDTHS.customer -
      COLUMN_WIDTHS.timeout -
      COLUMN_WIDTHS.missed -
      COLUMN_WIDTHS.remaining -
      COLUMN_SEPARATORS
  );
}

function buildCustomerHeader(columns) {
  const previewWidth = resolvePreviewWidth(columns);
  const header =
    `${padEnd("#", COLUMN_WIDTHS.order)}│${padEnd("客户", COLUMN_WIDTHS.customer)}│` +
    `${fit("超时状态", COLUMN_WIDTHS.timeout)}│${fit("漏回复状态", COLUMN_WIDTHS.missed)}│` +
    `${padEnd("倒计时", COLUMN_WIDTHS.remaining)}│${fit("最近消息", previewWidth)}`;
  return ansi.colorize(header, "brightBlue");
}

function singleLineText(value) {
  return normalizeCellText(value);
}

function buildCustomerRow(index, item, columns) {
  const split = splitStatusTags(item);
  const orderText = padEnd(String(index + 1), COLUMN_WIDTHS.order);
  const nameText = fit(singleLineText(item.customerName) || "未识别客户", COLUMN_WIDTHS.customer);
  const timeoutText = fit(
    colorizeTagLabel(split.timeoutTag?.label, split.timeoutTag?.type) || "未扫描",
    COLUMN_WIDTHS.timeout
  );
  const missedText = fit(
    colorizeTagLabel(split.missedReplyTag?.label, split.missedReplyTag?.type) || "未扫描",
    COLUMN_WIDTHS.missed
  );
  const remainingText = padEnd(resolveRemainingText(item), COLUMN_WIDTHS.remaining);
  const previewText = fit(
    singleLineText(item.previewText || item.lastCustomerMessageText),
    resolvePreviewWidth(columns)
  );
  return `${orderText}│${nameText}│${timeoutText}│${missedText}│${remainingText}│${previewText}`;
}

function renderCustomerDetail(item, app) {
  const lines = [];
  const split = splitStatusTags(item);
  const statusText = [
    split.timeoutTag ? colorizeTagLabel(split.timeoutTag.label, split.timeoutTag.type) : ansi.colorize("未扫描", "gray"),
    split.missedReplyTag ? colorizeTagLabel(split.missedReplyTag.label, split.missedReplyTag.type) : ansi.colorize("未扫描", "gray"),
    ...split.extraTags.map((tag) => colorizeTagLabel(tag.label, tag.type))
  ].filter(Boolean).join(" / ");
  lines.push(ansi.colorize(`客户：${item.customerName || "未识别客户"}`, "brightCyan"));
  lines.push(`状态：${statusText}`);
  if (item.timeoutDecisionReason) {
    lines.push(`超时依据：${item.timeoutDecisionReason}`);
  }
  if (item.missedReplyDecisionReason) {
    lines.push(`漏回复依据：${item.missedReplyDecisionReason}`);
  }
  if (item.reasonText) {
    lines.push(`判定：${item.reasonText}`);
  }
  lines.push("");
  lines.push(`最近消息：${item.latestMessageText || "无"}`);
  lines.push(`客户最后消息：${item.lastCustomerMessageText || "无"}`);
  lines.push(`客服最近回复：${item.recentAgentReplyText || "无"}`);
  if (item.latestMessageAtMs) {
    lines.push(`消息时间：${formatDateTimeText(item.latestMessageAtMs)}`);
  }
  if (item.missedReplyScannedAtMs) {
    lines.push(`判定时间：${formatDateTimeText(item.missedReplyScannedAtMs)}`);
  }
  const snapshot = item.recentReminderSnapshot;
  if (snapshot) {
    lines.push("");
    lines.push(ansi.colorize("最近一次提醒复盘", "brightBlue"));
    lines.push(`类型：${snapshot.reminderKindLabel || ""}  发送时间：${formatDateTimeText(snapshot.reminderSentAtMs)}`);
    if (snapshot.reasonLabel) {
      lines.push(`原因：${snapshot.reasonLabel}`);
    }
    if (snapshot.pendingDurationSeconds) {
      lines.push(`等待时长：${formatRemainingSeconds(snapshot.pendingDurationSeconds)}`);
    }
    if (snapshot.assignmentStatusLabel) {
      lines.push(`分配状态：${snapshot.assignmentStatusLabel}`);
    }
    if (snapshot.assigneeName) {
      lines.push(`接待客服：${snapshot.assigneeName}${snapshot.assigneeRoleLabel ? `（${snapshot.assigneeRoleLabel}）` : ""}`);
    }
    if (snapshot.latestMessageText) {
      lines.push(`最新消息：${snapshot.latestMessageText}`);
    }
    if (snapshot.dispatchTarget) {
      lines.push(`提醒对象：${snapshot.dispatchTarget}`);
    }
    if (snapshot.webhookName) {
      lines.push(`通知群：${snapshot.webhookName}`);
    }
  }
  return lines;
}

function hasStatusType(item, types) {
  const tags = Array.isArray(item.statusTags) ? item.statusTags : [];
  return tags.some((tag) => types.includes(tag?.type));
}

// 过滤模式：需关注（有 warning/danger）→ 已到点（只有 danger）→ 全部。
const FILTER_MODES = [
  { id: "attention", label: "需关注", test: (item) => hasStatusType(item, ["warning", "danger"]) },
  { id: "alert", label: "已到点", test: (item) => hasStatusType(item, ["danger"]) },
  { id: "all", label: "全部", test: () => true }
];

function resolveFilterMode(modeIndex) {
  return FILTER_MODES[modeIndex] || FILTER_MODES[0];
}

function filterCustomerItems(items, modeIndex) {
  const mode = resolveFilterMode(modeIndex);
  return items.filter(mode.test);
}

function createCustomersPage() {
  const page = {
    key: "2",
    title: "客户",
    state: {
      scrollOffset: 0,
      selectedIndex: 0,
      detail: null,
      detailScroll: 0,
      // 默认展示全部客户，避免进入客户页时只看到需关注项而误以为客户列表不完整。
      filterMode: 2
    },
    getFilteredItems(allItems) {
      return filterCustomerItems(allItems, this.state.filterMode);
    },
    cycleFilterMode() {
      this.state.filterMode = (this.state.filterMode + 1) % FILTER_MODES.length;
      this.state.selectedIndex = 0;
      this.state.scrollOffset = 0;
    },
    onEnter(app) {
      this.state.detail = null;
    },
    render(app) {
      const ctx = app.ctx;
      const allItems = (ctx.cache.dashboard?.customerMirrorItems) || [];
      const items = this.getFilteredItems(allItems);
      const columns = app.columns;
      const contentHeight = app.contentHeight;
      const filterMode = resolveFilterMode(this.state.filterMode);
      const freshnessLines = buildDataFreshnessLines(ctx.cache.dashboard?.dataFreshness, columns);

      if (this.state.detail) {
        const detailLines = renderCustomerDetail(this.state.detail, app);
        const maxOffset = Math.max(0, detailLines.length - contentHeight);
        if (this.state.detailScroll > maxOffset) {
          this.state.detailScroll = maxOffset;
        }
        return detailLines.slice(this.state.detailScroll, this.state.detailScroll + contentHeight);
      }

      if (allItems.length === 0) {
        return [
          ...freshnessLines,
          ansi.colorize("暂无客户判定数据。后台启动后，这里会显示完整联系人快照的状态。", "gray")
        ];
      }

      if (items.length === 0) {
        return [
          ...freshnessLines,
          ansi.colorize(fit(`当前过滤（${filterMode.label}）下没有客户，按 f 切换过滤。`, columns), "yellow")
        ];
      }

      if (this.state.selectedIndex >= items.length) {
        this.state.selectedIndex = items.length - 1;
      }
      const availableRows = Math.max(1, contentHeight - freshnessLines.length - 2);
      const maxOffset = Math.max(0, items.length - availableRows);
      if (this.state.scrollOffset > maxOffset) {
        this.state.scrollOffset = maxOffset;
      }

      const lines = [...freshnessLines];
      lines.push(buildCustomerHeader(columns));
      lines.push(ansi.colorize(
        fit(`（过滤:${filterMode.label}，显示 ${items.length}/${allItems.length} 个客户，f 切换）`, columns),
        "gray"
      ));

      const startIndex = this.state.scrollOffset;
      const endIndex = Math.min(items.length, startIndex + availableRows);
      for (let index = startIndex; index < endIndex; index += 1) {
        const item = items[index];
        const line = buildCustomerRow(index, item, columns);
        const highlighted = index === this.state.selectedIndex;
        lines.push(highlighted ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
      }

      if (items.length > availableRows) {
        lines.push(ansi.colorize(fit(`（共 ${items.length} 个客户，↑↓滚动）`, columns), "gray"));
      }
      return lines;
    },
    footer() {
      if (this.state.detail) {
        return "Esc 返回列表";
      }
      const filterMode = resolveFilterMode(this.state.filterMode);
      return `f切换过滤[${filterMode.label}] ↑↓选择 回车查看详情 ←→切页 q返回总览`;
    },
    handleKey(key, app) {
      const allItems = (app.ctx.cache.dashboard?.customerMirrorItems) || [];
      const items = this.getFilteredItems(allItems);
      const contentHeight = app.contentHeight;
      const columns = app.columns;
      const availableRows = Math.max(1, contentHeight - buildDataFreshnessLines(app.ctx.cache.dashboard?.dataFreshness, columns).length - 2);

      if (this.state.detail) {
        const detailLines = renderCustomerDetail(this.state.detail, app);
        const maxOffset = Math.max(0, detailLines.length - contentHeight);
        if (key === "up") {
          this.state.detailScroll = Math.max(0, this.state.detailScroll - 1);
          return true;
        }
        if (key === "down") {
          this.state.detailScroll = Math.min(maxOffset, this.state.detailScroll + 1);
          return true;
        }
        if (key === "pgup") {
          this.state.detailScroll = Math.max(0, this.state.detailScroll - contentHeight);
          return true;
        }
        if (key === "pgdn") {
          this.state.detailScroll = Math.min(maxOffset, this.state.detailScroll + contentHeight);
          return true;
        }
        if (key === "esc" || key === "enter" || key === "backspace") {
          this.state.detail = null;
          return true;
        }
        return false;
      }

      if (key === "f") {
        this.cycleFilterMode();
        return true;
      }

      if (items.length === 0) {
        return false;
      }

      if (key === "up") {
        if (this.state.selectedIndex > 0) {
          this.state.selectedIndex -= 1;
          if (this.state.selectedIndex < this.state.scrollOffset) {
            this.state.scrollOffset = this.state.selectedIndex;
          }
        }
        return true;
      }
      if (key === "down") {
        if (this.state.selectedIndex < items.length - 1) {
          this.state.selectedIndex += 1;
          if (this.state.selectedIndex >= this.state.scrollOffset + availableRows) {
            this.state.scrollOffset = this.state.selectedIndex - availableRows + 1;
          }
        }
        return true;
      }
      if (key === "pgup") {
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - availableRows);
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - availableRows);
        return true;
      }
      if (key === "pgdn") {
        this.state.selectedIndex = Math.min(items.length - 1, this.state.selectedIndex + availableRows);
        this.state.scrollOffset = Math.max(0, Math.min(items.length - availableRows, this.state.scrollOffset + availableRows));
        return true;
      }
      if (key === "home") {
        this.state.selectedIndex = 0;
        this.state.scrollOffset = 0;
        return true;
      }
      if (key === "end") {
        this.state.selectedIndex = items.length - 1;
        this.state.scrollOffset = Math.max(0, items.length - contentHeight);
        return true;
      }
      if (key === "enter") {
        this.state.detail = items[this.state.selectedIndex];
        this.state.detailScroll = 0;
        return true;
      }
      return false;
    }
  };

  return page;
}

module.exports = {
  createCustomersPage,
  buildCustomerRow,
  buildCustomerHeader,
  renderCustomerDetail,
  resolveRemainingText,
  singleLineText,
  splitStatusTags,
  filterCustomerItems,
  resolveFilterMode,
  hasStatusType
};
