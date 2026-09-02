const test = require("node:test");
const assert = require("node:assert/strict");
const { TUI应用, 解析转义键, 翻译按键字符 } = require("../../src/tui/共享路径").tuiApp;

function 创建模拟输出() {
  return {
    writes: [],
    columns: 100,
    rows: 28,
    write(chunk) {
      this.writes.push(String(chunk));
    },
    on() {},
    removeListener() {},
  };
}

function 创建模拟页面(key, title, renderLines = []) {
  return {
    key,
    title,
    render: () => [...renderLines],
    handleKey: () => false,
    footer: () => "",
  };
}

test("解析转义键：方向键、翻页键、回车、Ctrl+C 都能映射为统一按键名", () => {
  assert.equal(解析转义键("\x1b[A"), "up");
  assert.equal(解析转义键("\x1b[B"), "down");
  assert.equal(解析转义键("\x1b[C"), "right");
  assert.equal(解析转义键("\x1b[D"), "left");
  assert.equal(解析转义键("\x1b[5~"), "pgup");
  assert.equal(解析转义键("\x1b[6~"), "pgdn");
  assert.equal(解析转义键("\x1b[H"), "home");
  assert.equal(解析转义键("\x1b[F"), "end");
  assert.equal(翻译按键字符("\r"), "enter");
  assert.equal(翻译按键字符("\x03"), "ctrl-c");
  assert.equal(翻译按键字符("\x7f"), "backspace");
  assert.equal(翻译按键字符("a"), "a");
  assert.equal(解析转义键("\x1b[999~"), "unknown");
});

test("单独按 Esc 会被识别为 esc，而不会一直卡在转义序列缓冲区", async () => {
  let 收到按键 = "";
  const app = new TUI应用({
    pages: [{
      key: "1",
      title: "测试",
      render: () => [],
      handleKey: (按键) => {
        收到按键 = 按键;
        return true;
      },
      footer: () => "",
    }],
  });
  app.running = true;
  app.消费输入(Buffer.from("\x1b"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(收到按键, "esc");
  app.stop();
});

test("数字键可以直接切换页面，q 返回第一页", () => {
  const output = 创建模拟输出();
  const app = new TUI应用({
    title: "测试",
    pages: [
      创建模拟页面("1", "总览"),
      创建模拟页面("2", "店铺"),
      创建模拟页面("3", "订单"),
    ],
    output,
  });
  app.running = true;

  app.分发按键("3");
  assert.equal(app.currentPageIndex, 2);
  app.分发按键("2");
  assert.equal(app.currentPageIndex, 1);
  app.分发按键("q");
  assert.equal(app.currentPageIndex, 0);
});

test("左右键在主菜单循环切页，并优先让页面内部消费", () => {
  const output = 创建模拟输出();
  let 页面消费右移 = false;
  const pages = [
    创建模拟页面("1", "总览"),
    {
      key: "2",
      title: "店铺",
      render: () => [],
      footer: () => "",
      handleKey: (按键) => {
        if (按键 === "right") {
          页面消费右移 = true;
          return true;
        }
        return false;
      },
    },
    创建模拟页面("3", "订单"),
  ];
  const app = new TUI应用({ title: "测试", pages, output });
  app.running = true;

  // 在 1 页按右：循环切到 2 页
  app.分发按键("right");
  assert.equal(app.currentPageIndex, 1);
  // 在 2 页按右：页面内部消费，不切页
  app.分发按键("right");
  assert.equal(页面消费右移, true);
  assert.equal(app.currentPageIndex, 1);
  // 在 1 页按左：循环到最后一页
  app.切换页面(0);
  app.分发按键("left");
  assert.equal(app.currentPageIndex, 2);
  // 在最后一页按右：循环回第一页
  app.分发按键("right");
  assert.equal(app.currentPageIndex, 0);
});

test("Ctrl+C 直接触发退出，不再需要确认", () => {
  const output = 创建模拟输出();
  let 退出请求 = 0;
  const app = new TUI应用({
    title: "测试",
    pages: [创建模拟页面("1", "总览")],
    output,
    onExitRequest: () => {
      退出请求 += 1;
    },
  });
  app.running = true;

  app.分发按键("ctrl-c");
  assert.equal(退出请求, 1);
  assert.equal(app.exitConfirmPending, undefined);
});

test("渲染帧包含标题栏、时钟、菜单栏和页脚", () => {
  const output = 创建模拟输出();
  const app = new TUI应用({
    title: "京东开票巡检控制台",
    pages: [创建模拟页面("1", "总览", ["内容行一", "内容行二"])],
    output,
    statusBarProvider: () => ["状态行一", "状态行二"],
  });
  app.running = true;

  const 帧 = app.构建帧();
  assert.ok(Array.isArray(帧));
  assert.ok(帧.length >= 9);
  assert.ok(帧[0].includes("京东开票巡检控制台"));
  assert.ok(帧.some((行) => 行.includes("总览")));
  assert.ok(帧.some((行) => 行.includes("内容行一")));
  assert.ok(帧.some((行) => 行.includes("状态行一")));
});

test("差分渲染：内容变化时只更新变化的行", () => {
  const output = 创建模拟输出();
  const 页面数据 = { lines: ["第一行", "第二行"] };
  const page = {
    key: "1",
    title: "总览",
    render: () => [...页面数据.lines],
    handleKey: () => false,
    footer: () => "",
  };
  const app = new TUI应用({
    title: "测试",
    pages: [page],
    output,
  });
  app.running = true;

  app.render();
  const 首帧写入 = output.writes.length;
  assert.ok(output.writes.length > 0);

  // 再次渲染相同内容：不应产生任何输出（无变化）。
  output.writes = [];
  app.render();
  assert.equal(output.writes.length, 0);

  // 内容变化：应产生增量更新。
  页面数据.lines = ["第一行", "第二行已变化"];
  output.writes = [];
  app.render();
  assert.ok(output.writes.length > 0);
  assert.ok(output.writes.join("").includes("第二行已变化"));
});
