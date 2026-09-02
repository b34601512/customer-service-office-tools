// TUI 界面冒烟测试：用可注入输出流驱动 TuiApp，验证六个页面渲染、
// 模态输入框、退出确认与状态栏在真实配置下都能正常工作。
const assert = require("assert");
const { TuiApp, resolveEscapeKey, translateChar } = require("../src/cli/tui/tuiApp");
const { createOverviewPage } = require("../src/cli/tui/pages/overview");
const { createTasksPage, formatStoreResultLine } = require("../src/cli/tui/pages/tasks");
const { createStoresPage, findStore } = require("../src/cli/tui/pages/stores");
const { createSettingsPage } = require("../src/cli/tui/pages/settings");
const { createKdocsPage } = require("../src/cli/tui/pages/kdocs");
const { createHelpPage } = require("../src/cli/tui/pages/help");
const { createTuiServices } = require("../src/cli/tui/tuiServices");
const { buildStatusLines } = require("../src/cli/tui/startTuiRuntime");
const { formatSummaryTaskStatus } = require("../src/cli/tui/format");
const { normalizeCellText, stripAnsi, displayWidth, truncate, fit } = require("../src/cli/tui/width");

// ---- 按键翻译 ----
assert.strictEqual(resolveEscapeKey("\x1b[A"), "up");
assert.strictEqual(resolveEscapeKey("\x1b[B"), "down");
assert.strictEqual(resolveEscapeKey("\x1b[3~"), "delete");
assert.strictEqual(resolveEscapeKey("\x1b[99;5z"), "unknown");
assert.strictEqual(translateChar("\r"), "enter");
assert.strictEqual(translateChar("\x03"), "ctrl-c");

// ---- 纯函数 ----
assert.deepStrictEqual(formatSummaryTaskStatus("skipped"), { label: "跳过", color: "gray" });
assert.strictEqual(normalizeCellText("已发货｜发票..."), "已发货 · 发票");
assert.strictEqual(displayWidth("e\u0301"), 1);
assert.strictEqual(displayWidth("👍🏽"), 2);
assert.strictEqual(displayWidth("👩🏽‍💻"), 2);
assert.strictEqual(displayWidth("…—→"), 3);
assert.strictEqual(stripAnsi(truncate("👩🏽‍💻ABC", 3)), "👩🏽‍💻…");
assert.strictEqual(displayWidth(fit("\x1b[31m👩🏽‍💻e\u0301客户XYZ\x1b[0m", 8)), 8);
assert.doesNotMatch(
  stripAnsi(formatStoreResultLine({ status: "skipped", storeName: "京东一号", previousMetricCount: 3 }, 100, false)),
  /[|｜│]|\.\.\./
);

// ---- 可注入输出流 ----
function createMockOutput() {
  const chunks = [];
  return {
    columns: 100,
    rows: 30,
    written: "",
    write(text) {
      chunks.push(text);
      this.written += text;
    },
    on() {},
    removeListener() {}
  };
}

// ---- 页面装配（真实配置 + 假服务） ----
async function main() {
  const mockConfig = {
    workbook: { path: "C:/mock/汇总表.xlsx" },
    dateSelection: { mode: "automatic" },
    kdocsDataSourceSync: { documentUrl: "", webhookUrl: "", apiToken: "" },
    jd: {
      stores: [{ key: "jd1", displayName: "京东一号", enabled: true, username: "u", password: "p", sources: {} }]
    },
    tmall: { stores: [] },
    pdd: { stores: [] },
    douyin: {
      stores: [{
        key: "dy1",
        displayName: "抖音一号",
        enabled: true,
        username: "u",
        password: "p",
        platformStoreId: "x",
        platformStoreName: "平台店",
        sources: {}
      }]
    }
  };
  const services = createTuiServices({
    options: {
      readConfig: () => mockConfig,
      listEnabledStores: () => [
        { ...mockConfig.jd.stores[0], platformKey: "jd" },
        { ...mockConfig.douyin.stores[0], platformKey: "douyin" }
      ],
      readTaskHistory: () => ({ storeMetricRuns: [] }),
      getState: () => ({
        status: "idle",
        stage: "",
        detail: "",
        startedAt: "",
        completedAt: "",
        activeStoreKey: "",
        storeResults: [],
        result: null,
        error: ""
      }),
      patchState: () => {},
      subscribeState: () => () => {},
      runTask: async () => ({ detail: "mock" }),
      runKdocsDataSourceSync: async () => ({ remoteDataRowCount: 10 }),
      isKdocsSyncConfigured: () => false,
      openRecentEvidenceFolder: async () => {},
      openWorkbookDirectory: async () => {},
      openKdocsScript: async () => {},
      openKdocsDocument: async () => {},
      shutdown: async () => {}
    }
  });

  const pages = [
    createOverviewPage(),
    createTasksPage(),
    createStoresPage(),
    createSettingsPage(),
    createKdocsPage(),
    createHelpPage()
  ];
  const ctx = { services };
  pages.forEach((page) => {
    page.ctx = ctx;
  });

  const output = createMockOutput();
  let exitRequestCount = 0;
  const app = new TuiApp({
    title: "店铺指标自动更新 测试",
    pages,
    output,
    statusBarProvider: (tuiApp) => buildStatusLines(ctx, tuiApp),
    onExitRequest: () => {
      exitRequestCount += 1;
    }
  });
  app.ctx = ctx;

  // 每个页面都能构建完整一帧。
  app.running = true;
  for (let index = 0; index < pages.length; index += 1) {
    app.switchPage(index);
    const frame = app.buildFrame();
    assert.strictEqual(frame.length, app.rows, `页面 ${pages[index].title} 帧行数应等于终端行数`);
    assert.ok(frame.join("\n").length > 0);
  }

  // 状态栏内容包含运行状态与店铺统计。
  const statusLines = buildStatusLines(ctx, { columns: 100 });
  assert.strictEqual(statusLines.length, 2);
  assert.ok(statusLines[0].includes("状态"));
  assert.ok(statusLines[0].includes("启用店铺 2"));

  // 模态输入框：输入字符、退格、回车确认。
  const inputPromise = app.requestInput({ title: "测试输入", defaultValue: "" });
  app.dispatchKey("a");
  app.dispatchKey("b");
  app.dispatchKey("backspace");
  app.dispatchKey("enter");
  assert.strictEqual(await inputPromise, "a");

  // 模态确认框：y 确认 / n 取消。
  const confirmPromise = app.requestConfirm("测试确认");
  app.dispatchKey("n");
  assert.strictEqual(await confirmPromise, false);

  // 店铺页多级导航：平台 → 店铺 → 详情 → 返回。
  const storesPage = pages[2];
  app.switchPage(2);
  assert.strictEqual(storesPage.state.mode, "platforms");
  app.dispatchKey("enter"); // 进入京东店铺列表
  assert.strictEqual(storesPage.state.mode, "stores");
  assert.strictEqual(storesPage.state.platformKey, "jd");
  app.dispatchKey("enter"); // 进入店铺详情
  assert.strictEqual(storesPage.state.mode, "store");
  assert.strictEqual(storesPage.state.storeKey, "jd1");
  app.dispatchKey("down");
  app.dispatchKey("esc");
  assert.strictEqual(storesPage.state.mode, "stores");
  app.dispatchKey("esc");
  assert.strictEqual(storesPage.state.mode, "platforms");

  // findStore 纯函数。
  assert.strictEqual(findStore(mockConfig, "jd", "jd1").displayName, "京东一号");
  assert.strictEqual(findStore(mockConfig, "jd", "nope"), undefined);

  // 汇总页强制重采范围子菜单：choose → platform → 取消。
  const tasksPage = pages[1];
  app.switchPage(1);
  app.dispatchKey("f");
  assert.strictEqual(tasksPage.state.scopeMode, "choose");
  app.dispatchKey("down");
  app.dispatchKey("enter"); // 选择“某个平台”
  assert.strictEqual(tasksPage.state.scopeMode, "platform");
  app.dispatchKey("esc");
  assert.strictEqual(tasksPage.state.scopeMode, null);

  // 退出确认：ctrl-c 弹确认，n 取消。
  app.dispatchKey("ctrl-c");
  assert.strictEqual(app.exitConfirmPending, true);
  app.dispatchKey("n");
  assert.strictEqual(app.exitConfirmPending, false);

  // 菜单循环：顶部按上直达底部（退出控制台），底部按下回到顶部。
  const overviewPage = pages[0];
  app.switchPage(0);
  overviewPage.state.selection = 0;
  app.dispatchKey("up");
  assert.strictEqual(overviewPage.state.selection, 6);
  app.dispatchKey("down");
  assert.strictEqual(overviewPage.state.selection, 0);

  // 首页数字 0 和“退出控制台”动作都应立即退出，不弹二次确认。
  app.switchPage(0);
  app.dispatchKey("0");
  assert.strictEqual(exitRequestCount, 1);
  overviewPage.state.selection = 6;
  app.dispatchKey("enter");
  assert.strictEqual(exitRequestCount, 2);
  assert.strictEqual(app.exitConfirmPending, false);

  console.log("PASS TUI六页面渲染、模态输入/确认、多级导航与退出确认均正常");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
