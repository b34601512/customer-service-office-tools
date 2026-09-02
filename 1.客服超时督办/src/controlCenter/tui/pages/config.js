// 生产配置页：以表单方式编辑主管端高频参数，支持字符串/数字/开关/时间/关键词列表。
const ansi = require("../ansi");
const { fit, padEnd, displayWidth } = require("../width");
const { formatBool } = require("../format");

const MATCH_MODE_LABELS = {
  exact: "exact",
  startsWith: "startsWith",
  includes: "includes"
};

const FIELDS = [
  { key: "targetUrl", label: "客服工作台地址", type: "text" },
  { key: "timeoutReminderThresholdSeconds", label: "超时提醒阈值(秒)", type: "number" },
  { key: "missedReplyMonitorEnabled", label: "漏回复监控", type: "bool" },
  { key: "onlinePresenceMonitorEnabled", label: "上班监控", type: "bool" },
  { key: "transferAutoOpenEnabled", label: "自动打开转接待", type: "bool" },
  { key: "transferAutoCloseEnabled", label: "自动关闭转接待", type: "bool" },
  { key: "onlinePresenceScanIntervalMs", label: "上班监控扫描间隔(ms)", type: "number" },
  { key: "onlinePresenceWorkStartTime", label: "上班监控开始时间", type: "time" },
  { key: "missedReplyScanIntervalMs", label: "漏回复轮询间隔(ms)", type: "number" },
  { key: "missedReplyMaxContactsPerScan", label: "漏回复每轮扫描会话数", type: "number" },
  { key: "missedReplyTemporaryReplyKeywords", label: "稍等类临时回复关键词", type: "keywords" },
  { key: "missedReplyCustomerResolutionKeywords", label: "客户主动结案关键词", type: "keywords" },
  { key: "missedReplyCustomerClosingKeywords", label: "客户弱收尾关键词", type: "keywords" },
  { key: "missedReplyInvalidAgentReplyKeywords", label: "无效人工回复关键词", type: "keywords" },
  { key: "missedReplyPlatformNoticeKeywords", label: "平台提示过滤关键词", type: "keywords" },
  { key: "groupChatFilterEnabled", label: "群聊识别", type: "bool" },
  { key: "offDutyAutomationEnabled", label: "下班监控", type: "bool" },
  { key: "offDutyScanIntervalMs", label: "下班检查间隔(ms，默认5分钟)", type: "number" },
  { key: "offDutyPreSalesEarlyStartTime", label: "售前早班上班时间", type: "time" },
  { key: "offDutyPreSalesLateStartTime", label: "售前晚班上班时间", type: "time" },
  { key: "offDutyAfterSalesEarlyStartTime", label: "售后早班上班时间", type: "time" },
  { key: "offDutyAfterSalesLateStartTime", label: "售后晚班上班时间", type: "time" },
  { key: "offDutyPreSalesEarlyCloseTime", label: "售前早班关闭时间", type: "time" },
  { key: "offDutyPreSalesLateCloseTime", label: "售前晚班关闭时间", type: "time" },
  { key: "offDutyAfterSalesEarlyCloseTime", label: "售后早班关闭时间", type: "time" },
  { key: "offDutyAfterSalesLateCloseTime", label: "售后晚班关闭时间", type: "time" },
  { key: "offDutyTomorrowShiftNotificationEnabled", label: "明日排班提醒", type: "bool" }
];

function serializeKeywords(value) {
  // 这里把规则数组压成“关键词 | 匹配方式”一行一条的文本，供子编辑器直接展示和编辑。
  const rules = Array.isArray(value) ? value : [];
  return rules
    .map((rule) => {
      const text = String(rule?.text || "").trim();
      const mode = MATCH_MODE_LABELS[rule?.matchMode] || String(rule?.matchMode || "");
      return mode ? `${text} | ${mode}` : text;
    })
    .filter(Boolean);
}

function formatFieldValue(field, config) {
  const value = config[field.key];
  if (field.type === "bool") {
    return formatBool(value);
  }
  if (field.type === "keywords") {
    const count = Array.isArray(value) ? value.length : 0;
    return `共 ${count} 条规则`;
  }
  return String(value ?? "");
}

function createConfigPage() {
  const page = {
    key: "4",
    title: "配置",
    state: {
      config: null,
      selection: 0,
      edits: {},
      editing: null,
      editBuffer: "",
      keywordEditor: null,
      keywordBuffer: "",
      message: ""
    },
    reload(app) {
      try {
        this.state.config = app.ctx.services.readConfig();
        this.state.edits = {};
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      }
      if (this.state.selection >= FIELDS.length) {
        this.state.selection = 0;
      }
    },
    onEnter(app) {
      this.state.keywordEditor = null;
      this.state.editing = null;
      this.reload(app);
    },
    buildPayload() {
      // 这里以磁盘当前配置为底，叠加本次编辑过的字段，保证保存不会丢其它参数。
      const payload = { ...this.state.config };
      Object.entries(this.state.edits).forEach(([key, value]) => {
        payload[key] = value;
      });
      return payload;
    },
    render(app) {
      const columns = app.columns;
      const contentHeight = app.contentHeight;

      if (this.state.keywordEditor) {
        return this.renderKeywordEditor(app);
      }

      const config = this.state.config || {};
      const lines = [];
      lines.push(ansi.colorize(fit("生产参数（↑↓选择 回车编辑/切换 s保存 r重新加载）", columns), "brightBlue"));

      if (!this.state.config) {
        lines.push(ansi.colorize("配置读取失败，请检查 project-config 目录。", "brightRed"));
        return lines;
      }

      const labelWidth = 28;
      let shown = 0;
      for (let index = 0; index < FIELDS.length; index += 1) {
        if (shown >= contentHeight - 2) {
          break;
        }
        const field = FIELDS[index];
        const isEdited = Object.prototype.hasOwnProperty.call(this.state.edits, field.key);
        let valueText;
        if (field.type === "keywords") {
          valueText = isEdited ? "已修改" : formatFieldValue(field, config);
        } else if (isEdited) {
          valueText = String(this.state.edits[field.key]);
        } else {
          valueText = formatFieldValue(field, config);
        }
        const selected = index === this.state.selection;
        const prefix = selected ? "▶ " : "  ";
        if (isEdited) {
          valueText = ansi.colorize(`${valueText} ✎`, "brightYellow");
        }
        const line = `${prefix}${padEnd(field.label, labelWidth)} ${fit(valueText, columns - labelWidth - 3)}`;
        lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        shown += 1;
      }

      if (this.state.editing) {
        lines.push("");
        lines.push(ansi.colorize(fit(`编辑【${this.state.editing.label}】：${this.state.editBuffer}_`, columns), "brightCyan"));
        lines.push(ansi.colorize("回车确认 Esc取消", "gray"));
      }

      if (this.state.message) {
        lines.push("");
        lines.push(ansi.colorize(`提示：${this.state.message}`, "brightYellow"));
      }
      return lines;
    },
    renderKeywordEditor(app) {
      const columns = app.columns;
      const contentHeight = app.contentHeight;
      const editor = this.state.keywordEditor;
      const lines = [];
      lines.push(ansi.colorize(fit(`编辑【${editor.label}】共 ${editor.lines.length} 条（a新增 e编辑 d删除 s保存 q取消）`, columns), "brightBlue"));

      let shown = 0;
      for (let index = 0; index < editor.lines.length; index += 1) {
        if (shown >= contentHeight - 3) {
          break;
        }
        const selected = index === editor.selection;
        const line = `${selected ? "▶ " : "  "}${fit(String(editor.lines[index] || ""), columns - 3)}`;
        lines.push(selected ? ansi.colorize(fit(line, columns), "reverse") : fit(line, columns));
        shown += 1;
      }

      if (editor.inputActive) {
        lines.push("");
        lines.push(ansi.colorize(fit(`输入：${editor.inputBuffer}_`, columns), "brightCyan"));
      }
      return lines;
    },
    footer() {
      if (this.state.keywordEditor) {
        return this.state.keywordEditor.inputActive ? "输入内容，回车确认，Esc 取消" : "a新增 e编辑 d删除 s保存 q返回配置";
      }
      return "↑↓选择 回车编辑 s保存全部修改 r重新加载 ←→切页 q返回总览";
    },
    handleKey(key, app) {
      if (this.state.keywordEditor) {
        return this.handleKeywordEditorKey(key, app);
      }
      if (this.state.editing) {
        return this.handleEditingKey(key, app);
      }
      return this.handleListKey(key, app);
    },
    handleEditingKey(key) {
      const field = this.state.editing;
      if (key === "enter") {
        this.state.edits[field.key] = this.state.editBuffer.trim();
        this.state.editing = null;
        return true;
      }
      if (key === "esc") {
        this.state.editing = null;
        return true;
      }
      if (key === "backspace") {
        this.state.editBuffer = this.state.editBuffer.slice(0, -1);
        return true;
      }
      if (typeof key === "string" && key.length === 1 && key !== "\x7f") {
        this.state.editBuffer += key;
        return true;
      }
      return true;
    },
    handleListKey(key, app) {
      if (key === "up") {
        this.state.selection = Math.max(0, this.state.selection - 1);
        return true;
      }
      if (key === "down") {
        this.state.selection = Math.min(FIELDS.length - 1, this.state.selection + 1);
        return true;
      }
      if (key === "enter") {
        const field = FIELDS[this.state.selection];
        if (field.type === "bool") {
          const current = Boolean(this.state.config[field.key]);
          this.state.edits[field.key] = !current;
          this.state.config[field.key] = !current;
          return true;
        }
        if (field.type === "keywords") {
          const currentLines = serializeKeywords(
            Object.prototype.hasOwnProperty.call(this.state.edits, field.key)
              ? this.state.edits[field.key]
              : this.state.config[field.key]
          );
          this.state.keywordEditor = {
            field,
            label: field.label,
            lines: currentLines,
            selection: 0,
            inputActive: false,
            inputBuffer: ""
          };
          return true;
        }
        this.state.editing = field;
        this.state.editBuffer = String(this.state.config[field.key] ?? "");
        return true;
      }
      if (key === "s") {
        this.save(app);
        return true;
      }
      if (key === "r") {
        this.reload(app);
        this.state.message = "已从磁盘重新加载配置。";
        return true;
      }
      return false;
    },
    handleKeywordEditorKey(key, app) {
      const editor = this.state.keywordEditor;
      if (editor.inputActive) {
        if (key === "enter") {
          const value = editor.inputBuffer.trim();
          if (value) {
            if (editor.editingIndex >= 0) {
              editor.lines[editor.editingIndex] = value;
            } else {
              editor.lines.push(value);
            }
          }
          editor.inputActive = false;
          editor.inputBuffer = "";
          editor.editingIndex = -1;
          return true;
        }
        if (key === "esc") {
          editor.inputActive = false;
          editor.inputBuffer = "";
          editor.editingIndex = -1;
          return true;
        }
        if (key === "backspace") {
          editor.inputBuffer = editor.inputBuffer.slice(0, -1);
          return true;
        }
        if (typeof key === "string" && key.length === 1 && key !== "\x7f") {
          editor.inputBuffer += key;
          return true;
        }
        return true;
      }

      if (key === "up") {
        editor.selection = Math.max(0, editor.selection - 1);
        return true;
      }
      if (key === "down") {
        editor.selection = Math.min(editor.lines.length - 1, editor.selection + 1);
        return true;
      }
      if (key === "a") {
        editor.inputActive = true;
        editor.inputBuffer = "";
        editor.editingIndex = -1;
        return true;
      }
      if (key === "e") {
        if (editor.lines.length === 0) {
          return true;
        }
        editor.inputActive = true;
        editor.inputBuffer = String(editor.lines[editor.selection] || "");
        editor.editingIndex = editor.selection;
        return true;
      }
      if (key === "d") {
        if (editor.lines.length === 0) {
          return true;
        }
        editor.lines.splice(editor.selection, 1);
        if (editor.selection >= editor.lines.length) {
          editor.selection = Math.max(0, editor.lines.length - 1);
        }
        return true;
      }
      if (key === "s") {
        this.state.edits[editor.field.key] = editor.lines.join("\n");
        this.state.keywordEditor = null;
        this.state.message = `已暂存【${editor.label}】，按 s 保存全部修改生效。`;
        return true;
      }
      if (key === "q" || key === "esc") {
        this.state.keywordEditor = null;
        return true;
      }
      return false;
    },
    save(app) {
      try {
        const payload = this.buildPayload();
        const savedConfig = app.ctx.services.saveConfig(payload);
        this.state.config = savedConfig;
        this.state.edits = {};
        this.state.message = "配置已保存并写入 project-config/reply-config.js。";
      } catch (error) {
        this.state.message = error instanceof Error ? error.message : String(error);
      }
    }
  };

  return page;
}

module.exports = {
  createConfigPage,
  FIELDS,
  serializeKeywords,
  formatFieldValue
};
