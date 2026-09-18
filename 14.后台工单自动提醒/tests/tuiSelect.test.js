// 方向键菜单（src/cli/tuiSelect.js）：按键翻译、光标移动、数字键直达、渲染内容。
// 纯函数层测试，不碰真实终端；真实终端那条路用 winpty 手工跑过（见提交说明）。
const test = require("node:test");
const assert = require("node:assert");

const { resolveKey, createSelectMenu } = require("../src/cli/tuiSelect");

const 菜单 = [
  { key: "1", label: "立即巡检一轮", action: "once" },
  { key: "2", label: "启动常驻监控", action: "run" },
  { key: "8", label: "演练常驻监控", action: "dryRun" },
  { key: "0", label: "退出", action: "quit" }
];

function 造菜单(overrides = {}) {
  return createSelectMenu({ title: "14号 后台工单自动提醒", items: 菜单, ...overrides });
}

test("按键翻译：方向键/回车/退出/数字/Q 都认，乱码不认", () => {
  assert.strictEqual(resolveKey("\x1b[A"), "up");
  assert.strictEqual(resolveKey("\x1b[B"), "down");
  assert.strictEqual(resolveKey("\r"), "enter");
  assert.strictEqual(resolveKey("\x03"), "ctrl-c");
  assert.strictEqual(resolveKey("\x1b"), "escape");
  assert.strictEqual(resolveKey("8"), "8");
  assert.strictEqual(resolveKey("Q"), "q");
  assert.strictEqual(resolveKey("浣犲ソ"), null, "认不出来的输入必须返回 null（不猜、不误触发）");
});

test("↑↓ 移动会绕回，回车执行当前项", () => {
  const menu = 造菜单();
  assert.strictEqual(menu.index, 0);
  assert.strictEqual(menu.handleKey("up"), null);
  assert.strictEqual(menu.index, 3, "第一项按↑应绕到最后一项");
  assert.strictEqual(menu.handleKey("down"), null);
  assert.strictEqual(menu.index, 0);
  menu.handleKey("down");
  assert.deepStrictEqual(menu.handleKey("enter"), { action: "run" }, "回车执行当前高亮项");
});

test("数字键直达：按一下就执行，不用再按回车", () => {
  const menu = 造菜单();
  assert.deepStrictEqual(menu.handleKey("8"), { action: "dryRun" });
  assert.strictEqual(menu.index, 2, "直达后高亮要跟着走");
  assert.deepStrictEqual(menu.handleKey("0"), { action: "quit" });
  assert.strictEqual(menu.handleKey("9"), null, "没有对应选项的数字不许瞎触发");
});

test("q / Esc 退出，Ctrl+C 由调用方处理", () => {
  const menu = 造菜单();
  assert.deepStrictEqual(menu.handleKey("q"), { action: "quit" });
  assert.deepStrictEqual(menu.handleKey("escape"), { action: "quit" });
});

test("渲染：标题、当前项反色标记 ›、其余项不对齐也看得清、页脚按键提示", () => {
  const menu = 造菜单({ footerNotes: ["常驻监控：未启动"] });
  const 第一屏 = menu.render().join("\n");
  assert.ok(第一屏.includes("14号 后台工单自动提醒"), "要有标题");
  assert.ok(第一屏.includes("› [1] 立即巡检一轮"), "当前项要有 › 标记");
  assert.ok(第一屏.includes("\x1b[7m"), "当前项要反色");
  assert.ok(第一屏.includes("↑↓ 选择"), "要有按键提示（用户要的上下选择）");
  assert.ok(第一屏.includes("数字键直达"), "要说明数字键可直接按");
  assert.ok(第一屏.includes("常驻监控：未启动"), "要能显示状态备注");

  menu.handleKey("down");
  const 第二屏 = menu.render().join("\n");
  assert.ok(第二屏.includes("› [2] 启动常驻监控"), "移动后标记要跟着走");
  assert.ok(!第二屏.includes("› [1] 立即巡检一轮"), "旧高亮要消失");
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

// 终端层（runSelectMenu）：用假 TTY 跑，验证进入/退出备用屏、raw 模式开关、按键驱动选择。
const { runSelectMenu, ANSI } = require("../src/cli/tuiSelect");

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
    removeListener(_event, handler) {
      const i = 监听.indexOf(handler);
      if (i >= 0) 监听.splice(i, 1);
    }
  };
  const stdout = {
    isTTY: true,
    write(text) {
      写入.push(text);
    }
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

test("终端层：进备用屏+隐藏光标+开 raw，方向键移动后回车返回选中动作，退出后还原现场", async () => {
  const tty = makeFakeTty();
  const promise = runSelectMenu({ title: "14号", items: 菜单, stdin: tty.stdin, stdout: tty.stdout });

  assert.ok(tty.文本.includes(ANSI.enterAltScreen), "要进备用屏（不污染日志）");
  assert.ok(tty.文本.includes(ANSI.hideCursor), "要隐藏光标");
  assert.strictEqual(tty.state.raw, true, "要开 raw 模式才能读方向键");
  assert.ok(tty.文本.includes("› [1] 立即巡检一轮"), "首屏要高亮第一项");

  tty.按键("\x1b[B"); // ↓
  assert.ok(tty.文本.includes("› [2] 启动常驻监控"), "↓ 之后高亮第二项");
  tty.按键("\r"); // 回车

  assert.strictEqual(await promise, "run", "回车要返回当前项的动作");
  assert.ok(tty.文本.includes(ANSI.leaveAltScreen), "退出要离开备用屏");
  assert.ok(tty.文本.includes(ANSI.showCursor), "退出要恢复光标");
  assert.strictEqual(tty.state.raw, false, "退出要关 raw 模式");
  assert.strictEqual(tty.state.paused, true, "退出要暂停 stdin");
});

test("终端层：数字键直达；Ctrl+C 返回 quit；非交互环境返回 null 让调用方回退", async () => {
  const tty = makeFakeTty();
  const promise = runSelectMenu({ title: "14号", items: 菜单, stdin: tty.stdin, stdout: tty.stdout });
  tty.按键("8");
  assert.strictEqual(await promise, "dryRun", "数字键要直达对应动作");

  const tty2 = makeFakeTty();
  const promise2 = runSelectMenu({ title: "14号", items: 菜单, stdin: tty2.stdin, stdout: tty2.stdout });
  tty2.按键("\x03");
  assert.strictEqual(await promise2, "quit", "Ctrl+C 要当退出处理");

  const 结果 = await runSelectMenu({ title: "14号", items: 菜单, stdin: { isTTY: false }, stdout: { isTTY: true } });
  assert.strictEqual(结果, null, "非交互环境要返回 null（调用方回退到输入式菜单）");
});
