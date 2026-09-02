// 实时日志页：订阅状态总线日志，支持滚动查看和关键字过滤。
const ansi = require("../ansi");
const { fit } = require("../width");

const MAX_LOG_LINES = 3000;

function extractLogTime(line) {
  // 这里从结构化日志行里抽出时间字段，让日志列表左侧能看到时间列。
  const match = String(line || "").match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function createLogsPage() {
  const page = {
    key: "3",
    title: "日志",
    state: {
      lines: [],
      scrollOffset: 0,
      follow: true,
      filterActive: false,
      filterBuffer: "",
      filterText: ""
    },
    pushLine(line) {
      this.state.lines.push(String(line || ""));
      if (this.state.lines.length > MAX_LOG_LINES) {
        this.state.lines.splice(0, this.state.lines.length - MAX_LOG_LINES);
      }
      if (this.state.follow && !this.state.filterActive) {
        this.state.scrollOffset = 0;
      }
    },
    onEnter(app) {
      this.state.filterActive = false;
      if (this.state.follow) {
        this.state.scrollOffset = 0;
      }
    },
    getVisibleLines() {
      const filterText = this.state.filterText.trim().toLowerCase();
      const allLines = this.state.lines;
      const visibleLines = filterText
        ? allLines.filter((line) => String(line).toLowerCase().includes(filterText))
        : allLines;
      return visibleLines;
    },
    render(app) {
      const columns = app.columns;
      const contentHeight = app.contentHeight;
      const visibleLines = this.getVisibleLines();

      if (this.state.follow) {
        this.state.scrollOffset = 0;
      }
      const maxOffset = Math.max(0, visibleLines.length - contentHeight);
      if (this.state.scrollOffset > maxOffset) {
        this.state.scrollOffset = maxOffset;
      }

      const lines = [];
      const filterText = this.state.filterText.trim();
      lines.push(ansi.colorize(
        fit(`日志（${visibleLines.length} 条${filterText ? `，过滤“${filterText}”` : ""}${this.state.follow ? "，跟随最新" : ""}）`, columns),
        "brightBlue"
      ));

      if (visibleLines.length === 0) {
        lines.push(ansi.colorize("暂无日志。启动任务后日志会实时出现在这里。", "gray"));
        return lines;
      }

      const startIndex = Math.max(0, visibleLines.length - this.state.scrollOffset - contentHeight);
      const endIndex = visibleLines.length - this.state.scrollOffset;
      for (let index = startIndex; index < endIndex; index += 1) {
        const rawLine = visibleLines[index] || "";
        const timeText = extractLogTime(rawLine);
        const timeWidth = timeText ? timeText.length + 1 : 0;
        const body = timeText ? rawLine.slice(timeText.length + 1) : rawLine;
        const coloredBody = body.includes("主线:失败")
          ? ansi.colorize(fit(body, columns - timeWidth), "brightRed")
          : fit(body, columns - timeWidth);
        lines.push(`${timeText ? fit(timeText, timeWidth) : ""}${coloredBody}`);
      }
      return lines;
    },
    footer() {
      const filterHint = this.state.filterActive ? "输入过滤关键字，回车应用，Esc 取消" : "↑↓滚动 PgUp/PgDn翻页 /过滤 f跟随/停止 r清屏 ←→切页 q返回总览";
      return filterHint;
    },
    handleKey(key, app) {
      if (this.state.filterActive) {
        if (key === "enter") {
          this.state.filterText = this.state.filterBuffer;
          this.state.filterActive = false;
          this.state.follow = true;
          this.state.scrollOffset = 0;
          return true;
        }
        if (key === "esc") {
          this.state.filterActive = false;
          this.state.filterBuffer = "";
          return true;
        }
        if (key === "backspace") {
          this.state.filterBuffer = this.state.filterBuffer.slice(0, -1);
          return true;
        }
        if (typeof key === "string" && key.length === 1 && key >= " " && key !== "\x7f") {
          this.state.filterBuffer += key;
          return true;
        }
        return true;
      }

      const visibleLines = this.getVisibleLines();
      const contentHeight = app.contentHeight;
      const maxOffset = Math.max(0, visibleLines.length - contentHeight);

      if (key === "/") {
        this.state.filterActive = true;
        this.state.filterBuffer = "";
        return true;
      }
      if (key === "f") {
        this.state.follow = !this.state.follow;
        if (this.state.follow) {
          this.state.scrollOffset = 0;
        }
        return true;
      }
      if (key === "r") {
        this.state.lines = [];
        return true;
      }
      if (key === "up") {
        this.state.follow = false;
        this.state.scrollOffset = Math.min(maxOffset, this.state.scrollOffset + 1);
        return true;
      }
      if (key === "down") {
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
        if (this.state.scrollOffset === 0) {
          this.state.follow = true;
        }
        return true;
      }
      if (key === "pgup") {
        this.state.follow = false;
        this.state.scrollOffset = Math.min(maxOffset, this.state.scrollOffset + contentHeight);
        return true;
      }
      if (key === "pgdn") {
        this.state.scrollOffset = Math.max(0, this.state.scrollOffset - contentHeight);
        if (this.state.scrollOffset === 0) {
          this.state.follow = true;
        }
        return true;
      }
      if (key === "home") {
        this.state.follow = false;
        this.state.scrollOffset = maxOffset;
        return true;
      }
      if (key === "end") {
        this.state.scrollOffset = 0;
        this.state.follow = true;
        return true;
      }
      return false;
    }
  };

  return page;
}

module.exports = {
  createLogsPage,
  extractLogTime
};
