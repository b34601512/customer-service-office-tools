const test = require("node:test");
const assert = require("node:assert/strict");
const { displayWidth, padEnd, truncate, fit, stripAnsi, isWideChar } = require("../../src/controlCenter/tui/width");
const { resolveEscapeKey, translateChar, TuiApp } = require("../../src/controlCenter/tui/tuiApp");
const { buildStatusLines } = require("../../src/controlCenter/tui/startTui");

// 测试用假输出流，避免 TUI 渲染把终端帧写进测试输出。
function createMockOutput() {
  return {
    writes: [],
    columns: 80,
    rows: 24,
    write(chunk) {
      this.writes.push(String(chunk));
    },
    on() {},
    removeListener() {}
  };
}

test("显示宽度应该把中文按 2 列计算", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("客服"), 4);
  assert.equal(displayWidth("a客服b"), 6);
  assert.equal(displayWidth("！"), 2);
});

test("显示宽度应该按完整可见字形计算组合符号和表情", () => {
  // 这是当前客户列表中的真实昵称：三个附加符都叠在“心”上，不应各占一列。
  assert.equal(displayWidth("এ心᭄ོꦿ惢࿐【客户】"), 14);
  assert.equal(displayWidth("e\u0301"), 1);
  assert.equal(displayWidth("👍🏽"), 2);
  assert.equal(displayWidth("👨‍👩‍👧‍👦"), 2);
  assert.equal(displayWidth("1️⃣"), 2);
});

test("显示宽度应该忽略 ANSI 颜色码", () => {
  assert.equal(displayWidth("\x1b[31m红色\x1b[0m"), 4);
  assert.equal(stripAnsi("\x1b[1;36m青蓝\x1b[0m"), "青蓝");
});

test("padEnd 应该按显示宽度补齐", () => {
  assert.equal(padEnd("客户", 6), "客户  ");
  assert.equal(displayWidth(padEnd("客户", 6)), 6);
});

test("truncate 应该按显示宽度截断并保留 ANSI 码完整", () => {
  const truncated = truncate("客服超时督办测试长文本", 10);
  assert.ok(displayWidth(truncated) <= 10);
  assert.ok(displayWidth(truncated) >= 8);
  const colored = truncate("\x1b[31m客服超时督办测试长文本\x1b[0m", 8);
  assert.ok(colored.includes("\x1b[31m"));
  assert.ok(colored.includes("\x1b[0m"));
});

test("truncate 不应该从组合字形或表情序列中间切开", () => {
  assert.equal(truncate("👍🏽客户", 3), "👍🏽…");
  assert.equal(truncate("👨‍👩‍👧‍👦客户", 3), "👨‍👩‍👧‍👦…");
});

test("fit 应该保证结果显示宽度不超过目标宽度", () => {
  const result = fit("a".repeat(50), 20);
  assert.equal(displayWidth(result), 20);
  const chineseResult = fit("超时".repeat(30), 18);
  assert.ok(displayWidth(chineseResult) <= 18);
});

test("isWideChar 应该识别常用全角字符", () => {
  assert.equal(isWideChar("中"), true);
  assert.equal(isWideChar("a"), false);
  assert.equal(isWideChar("【"), true);
  assert.equal(isWideChar("！"), true);
});

test("歧义标点（省略号/破折号/箭头）在等宽终端按英文字符 1 列计算", () => {
  assert.equal(isWideChar("…"), false);
  assert.equal(isWideChar("—"), false);
  assert.equal(isWideChar("“"), false);
  assert.equal(displayWidth("顺丰—德达查催群"), 15); // 顺丰4+—1+德达查催群10
  assert.equal(displayWidth("客服…"), 5); // 客2+服2+…1
});

test("转义序列应该解析成方向键", () => {
  assert.equal(resolveEscapeKey("\x1b[A"), "up");
  assert.equal(resolveEscapeKey("\x1b[B"), "down");
  assert.equal(resolveEscapeKey("\x1b[C"), "right");
  assert.equal(resolveEscapeKey("\x1b[D"), "left");
  assert.equal(resolveEscapeKey("\x1bOA"), "up");
  assert.equal(resolveEscapeKey("\x1b[5~"), "pgup");
  assert.equal(resolveEscapeKey("\x1b[6~"), "pgdn");
  assert.equal(resolveEscapeKey("\x1b[3~"), "delete");
  assert.equal(resolveEscapeKey("\x1b[H"), "home");
  assert.equal(resolveEscapeKey("\x1b[F"), "end");
});

test("单个字符应该翻译成统一按键", () => {
  assert.equal(translateChar("\r"), "enter");
  assert.equal(translateChar("\n"), "enter");
  assert.equal(translateChar("\x03"), "ctrl-c");
  assert.equal(translateChar("\x7f"), "backspace");
  assert.equal(translateChar("a"), "a");
  assert.equal(translateChar("1"), "1");
});

test("buildStatusLines 应该固定输出两行并在登录确认时提示", () => {
  const ctx = {
    state: {
      currentTask: {
        taskName: "start",
        label: "后台督办",
        status: "running",
        startedAt: new Date(Date.now() - 60 * 1000).toISOString(),
        pid: 12345,
        awaitingConfirmation: true
      }
    },
    cache: {
      loginStatus: { status: "valid", verifiedAt: "2026-08-15 09:00:00" },
      dashboard: { monitorSummary: { attentionCount: 2, stateText: "需关注", detailText: "客户判定=20" } }
    }
  };
  const fakeApp = { columns: 80 };
  const lines = buildStatusLines(ctx, fakeApp, 39360);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("后台督办"));
  assert.ok(lines[1].includes("完成登录"));
});

test("TuiApp 应该能用桩页面构建完整帧", () => {
  const app = new TuiApp({
    title: "测试控制台",
    output: createMockOutput(),
    pages: [
      {
        key: "1",
        title: "首页",
        render: () => ["内容行一", "内容行二"],
        handleKey: () => false
      }
    ],
    statusBarProvider: () => ["状态行一", ""]
  });
  app.running = true;
  const frame = app.buildFrame();
  assert.ok(Array.isArray(frame));
  assert.ok(frame.length >= 9);
  assert.ok(frame[0].includes("测试控制台"));
  assert.ok(frame.some((line) => line.includes("内容行一")));
});

test("TuiApp 全局数字键应该能切换页面", () => {
  const app = new TuiApp({
    output: createMockOutput(),
    pages: [
      { key: "1", title: "一", render: () => [], handleKey: () => false },
      { key: "2", title: "二", render: () => [], handleKey: () => false }
    ],
    statusBarProvider: () => ["", ""]
  });
  app.running = true;
  app.switchPage(1);
  assert.equal(app.currentPageIndex, 1);
  assert.equal(app.page.title, "二");
});

test("左右键应该在主菜单循环切换页面", () => {
  const app = new TuiApp({
    output: createMockOutput(),
    pages: [
      { key: "1", title: "一", render: () => [], handleKey: () => false },
      { key: "2", title: "二", render: () => [], handleKey: () => false },
      { key: "3", title: "三", render: () => [], handleKey: () => false }
    ],
    statusBarProvider: () => ["", ""]
  });
  app.running = true;
  app.dispatchKey("right");
  assert.equal(app.page.title, "二");
  app.dispatchKey("right");
  assert.equal(app.page.title, "三");
  app.dispatchKey("right"); // 循环回第一页
  assert.equal(app.page.title, "一");
  app.dispatchKey("left"); // 向前循环
  assert.equal(app.page.title, "三");
});

test("页面内部消费左右键时不应该触发主菜单切页", () => {
  const app = new TuiApp({
    output: createMockOutput(),
    pages: [
      {
        key: "1",
        title: "一",
        render: () => [],
        handleKey: (key) => key === "left" || key === "right"
      },
      { key: "2", title: "二", render: () => [], handleKey: () => false }
    ],
    statusBarProvider: () => ["", ""]
  });
  app.running = true;
  app.dispatchKey("right");
  assert.equal(app.page.title, "一"); // 页面消费了 right，不应切页
  app.dispatchKey("left");
  assert.equal(app.page.title, "一");
});

test("TuiApp 差分渲染应该只重绘变化的行", async () => {
  const output = createMockOutput();
  let dynamicValue = "第一版";
  const app = new TuiApp({
    output,
    pages: [
      {
        key: "1",
        title: "首页",
        render: () => ["固定行一", `动态行：${dynamicValue}`],
        handleKey: () => false
      }
    ],
    statusBarProvider: () => ["", ""]
  });
  app.running = true;
  app.render();
  const firstFrameWrites = output.writes.length;
  // 内容不变时再次渲染不应有任何输出
  app.render();
  assert.equal(output.writes.length, firstFrameWrites);
  // 内容变化时只输出变化行（包含光标定位 + 清行）
  dynamicValue = "第二版";
  app.render();
  const delta = output.writes[output.writes.length - 1];
  assert.ok(delta.includes("\x1b[7;1H")); // 标题1+状态2+菜单1+分隔1=5行，固定行=第6行，动态行=第7行
  assert.ok(delta.includes("动态行：第二版"));
  assert.ok(!delta.includes("固定行一"));
});
