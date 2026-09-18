// 方向键常驻界面（src/cli/tuiSelect.js）：按键翻译、光标移动、数字键直达、渲染内容、常驻帧的重绘/挂起。
// 纯函数层 + 终端层都用假 TTY 跑，不碰真实终端；真实终端那条路用 SendKeys 手工跑过（见提交说明）。
const test = require("node:test");
const assert = require("node:assert");

const { resolveKey, createSelectMenu, runLiveMenu, ANSI } = require("../src/cli/tuiSelect");

const 菜单 = [
  { key: "1", label: "启动常驻监控", action: "run" },
  { key: "2", label: "停止常驻监控", action: "stop" },
  { key: "3", label: "立即巡检一轮", action: "once" },
  { key: "4", label: "查看状态", action: "status" },
  { key: "0", label: "退出", action: "quit" }
];

function 造菜单(overrides = {}) {
  return createSelectMenu({ title: "14号 后台工单自动提醒", items: 菜单, ...overrides });
}

function makeFakeTty() {
  const 写入 = [];
  const 监听 = [];
  const state = { raw: null, resumed: false, paused: false };
  const stdin = {
    isTTY: true,
    setRawMode(value) {
      state.raw = value;
    },
    resume() {
      state.resumed = true;
    },
    pause() {
      state.paused = true;
    },
    on(_event, handler) {
      监听.push(handler);
    },
    once(_event, handler) {
      监听.push(handler);
    },
    listenerCount() {
      return 监听.length;
    },
    setEncoding() {},
    removeListener(_event, handler) {
      const i = 监听.indexOf(handler);
      if (i >= 0) 监听.splice(i, 1);
    }
  };
  const stdout = {
    isTTY: true,
    write(text) {
      写入.push(text);
    },
    on() {},
    once() {},
    listenerCount() {
      return 0;
    },
    removeListener() {},
    columns: 100,
    rows: 40
  };
  return {
    stdin,
    stdout,
    state,
    get 文本() {
      return 写入.join("");
    },
    按键(buffer) {
      for (const handler of [...监听]) handler(Buffer.from(buffer, "utf8"));
    }
  };
}

test("按键翻译：方向键/回车/退出/数字/Q 都认，乱码不认", () => {
  assert.strictEqual(resolveKey("\x1b[A"), "up");
  assert.strictEqual(resolveKey("\x1b[B"), "down");
  assert.strictEqual(resolveKey("\r"), "enter");
  assert.strictEqual(resolveKey("\x03"), "ctrl-c");
  assert.strictEqual(resolveKey("\x1b"), "escape");
  assert.strictEqual(resolveKey("4"), "4");
  assert.strictEqual(resolveKey("Q"), "q");
  assert.strictEqual(resolveKey("浣犲ソ"), null, "认不出来的输入必须返回 null（不猜、不误触发）");
});

test("↑↓ 移动会绕回，回车执行当前项", () => {
  const menu = 造菜单();
  assert.strictEqual(menu.index, 0);
  assert.strictEqual(menu.handleKey("up"), null);
  assert.strictEqual(menu.index, 4, "第一项按↓前先按↑应绕到最后一项");
  assert.strictEqual(menu.handleKey("down"), null);
  assert.strictEqual(menu.index, 0);
  menu.handleKey("down");
  assert.deepStrictEqual(menu.handleKey("enter"), { action: "stop" }, "回车执行当前高亮项");
});

test("数字键直达：按一下就执行，不用再按回车", () => {
  const menu = 造菜单();
  assert.deepStrictEqual(menu.handleKey("4"), { action: "status" });
  assert.strictEqual(menu.index, 3, "直达后高亮要跟着走");
  assert.deepStrictEqual(menu.handleKey("0"), { action: "quit" });
  assert.strictEqual(menu.handleKey("9"), null, "没有对应选项的数字不许瞎触发");
});

test("q / Esc 退出，Ctrl+C 由调用方处理", () => {
  const menu = 造菜单();
  assert.deepStrictEqual(menu.handleKey("q"), { action: "quit" });
  assert.deepStrictEqual(menu.handleKey("escape"), { action: "quit" });
});

test("渲染：标题、状态行、当前项反色标记 ›、页脚按键提示都在", () => {
  const menu = 造菜单({
    statusLines: () => ["常驻监控：运行中", "数据新鲜度 ███░░░ 50%"],
    footerNotes: ["血条＝数据新鲜度"]
  });
  const 屏 = menu.render().join("\n");
  assert.ok(屏.includes("14号 后台工单自动提醒"), "要有标题");
  assert.ok(屏.includes("常驻监控：运行中"), "要显示运行状态（用户看不清在不在跑）");
  assert.ok(屏.includes("数据新鲜度"), "要有血条");
  assert.ok(屏.includes("› [1] 启动常驻监控"), "当前项要有 › 标记");
  assert.ok(屏.includes("\x1b[7m"), "当前项要反色");
  assert.ok(屏.includes("↑↓ 选择"), "要有按键提示（用户要的上下选择）");
  assert.ok(屏.includes("数字键直达"), "要说明数字键可直接按");

  menu.handleKey("down");
  const 第二屏 = menu.render().join("\n");
  assert.ok(第二屏.includes("› [2] 停止常驻监控"), "移动后标记要跟着走");
  assert.ok(!第二屏.includes("› [1] 启动常驻监控"), "旧高亮要消失");
});

test("选项多于一屏时分页，光标移动窗口跟着走", () => {
  const 多项 = Array.from({ length: 20 }, (_, i) => ({ key: String(i), label: `第${i}项`, action: `a${i}` }));
  const menu = createSelectMenu({ title: "长菜单", items: 多项, pageSize: 5, footerNotes: [] });
  const 首页 = menu.render().join("\n");
  assert.ok(首页.includes("第0项") && !首页.includes("第5项"), "首页只显示前 5 项");
  for (let i = 0; i < 6; i += 1) menu.handleKey("down");
  const 第二页 = menu.render().join("\n");
  assert.ok(第二页.includes("› [6] 第6项"), "光标超出窗口后窗口要跟着滚动");
});

test("常驻帧：进一次备用屏、原地重绘（不清屏）、按键驱动动作、退出还原现场", async () => {
  const tty = makeFakeTty();
  const 收到 = [];
  const promise = runLiveMenu({
    title: "14号",
    items: 菜单,
    statusLines: () => ["常驻监控：运行中"],
    tickMs: 10,
    stdin: tty.stdin,
    stdout: tty.stdout,
    dispatch: async (action) => {
      收到.push(action);
    }
  });

  assert.ok(tty.文本.includes(ANSI.enterAltScreen), "要进备用屏");
  assert.strictEqual(tty.state.raw, true, "要开 raw 模式才能读方向键");
  assert.ok(tty.文本.includes("› [1] 启动常驻监控"), "首屏要高亮第一项");
  assert.ok(!tty.文本.includes("\x1b[2J"), "不许用清屏（清屏就是闪烁的根源）");

  tty.按键("\x1b[B");
  assert.ok(tty.文本.includes("› [2] 停止常驻监控"), "↓ 之后高亮第二项");
  tty.按键("\r");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(收到, ["stop"], "回车要把当前项交给 dispatch");

  tty.按键("0");
  assert.strictEqual(await promise, "quit", "按 0 要退出界面");
  assert.ok(tty.文本.includes(ANSI.leaveAltScreen), "退出要离开备用屏");
  assert.ok(tty.文本.includes(ANSI.showCursor), "退出要恢复光标");
  assert.strictEqual(tty.state.raw, false, "退出要关 raw 模式");
});

test("常驻帧：每秒自动重绘（血条会动）、执行中忽略按键并提示、数字键直达", async () => {
  const tty = makeFakeTty();
  let 剩余 = 100;
  let 放行 = null;
  const promise = runLiveMenu({
    title: "14号",
    items: 菜单,
    statusLines: () => [`血条测试 ${剩余}`],
    tickMs: 5,
    stdin: tty.stdin,
    stdout: tty.stdout,
    dispatch: (action) => {
      剩余 = 0;
      return new Promise((resolve) => {
        放行 = () => resolve(action === "once" ? "quit" : undefined);
      });
    }
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.ok(tty.文本.includes("血条测试 100"), "首帧要画状态");

  tty.按键("3"); // 立即巡检一轮 → dispatch 挂住（模拟一次 20 秒的巡检）
  await new Promise((r) => setTimeout(r, 30));
  const 执行中 = tty.文本.slice(tty.文本.lastIndexOf("\x1b[H"));
  assert.ok(执行中.includes("正在执行"), "执行中要提示，别让人以为界面死了");
  assert.ok(执行中.includes("血条测试 0"), "执行中血条仍要继续走");
  assert.ok(执行中.includes("› [3] 立即巡检一轮"), "执行中高亮不能乱跳");

  tty.按键("1"); // 执行中按键要被忽略，不能排队触发第二个动作
  await new Promise((r) => setTimeout(r, 10));
  放行();
  assert.strictEqual(await promise, "quit", "dispatch 返回 quit 时界面收尾");
});

test("界面挂起/恢复：io.ask 期间离开备用屏，回来后接着画（登录、看状态用）", async () => {
  const tty = makeFakeTty();
  let 挂起时内容 = null;
  const promise = runLiveMenu({
    title: "14号",
    items: 菜单,
    statusLines: () => ["常驻监控：运行中"],
    stdin: tty.stdin,
    stdout: tty.stdout,
    dispatch: async (_action, io) => {
      // 挂起期间不能还在画帧：这里模拟 io.ask（内部走挂起/恢复）
      const 问 = io.ask("店铺key: ");
      await new Promise((r) => setTimeout(r, 10));
      挂起时内容 = tty.文本.lastIndexOf(ANSI.leaveAltScreen) > tty.文本.lastIndexOf(ANSI.enterAltScreen);
      return "quit";
    }
  });
  tty.按键("1");
  await promise;
  assert.strictEqual(挂起时内容, true, "io.ask 要先把界面挂起（离开备用屏）");
  assert.ok(tty.文本.includes(ANSI.enterAltScreen), "回来后要重新进备用屏接着画");
});

test("非交互环境返回 null，由调用方回退到输入式菜单", async () => {
  const 结果 = await runLiveMenu({ title: "14号", items: 菜单, stdin: { isTTY: false }, stdout: { isTTY: true } });
  assert.strictEqual(结果, null);
});
