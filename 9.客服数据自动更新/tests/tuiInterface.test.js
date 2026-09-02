// TUI 界面冒烟测试：用可注入输出流驱动 TuiApp，验证六个页面渲染、
// 模态输入框、退出确认与状态栏在真实配置下都能正常工作。
const assert = require("assert");
const { TuiApp } = require("../src/cli/tui/tuiApp");
const { createOverviewPage, isSummaryRunning } = require("../src/cli/tui/pages/overview");
const { createTasksPage, formatTaskLine } = require("../src/cli/tui/pages/tasks");
const { createStorePage, isValidCalendarDate: storeDate } = require("../src/cli/tui/pages/stores");
const { createSettingsPage, parseSourceNames } = require("../src/cli/tui/pages/settings");
const { createKdocsPage } = require("../src/cli/tui/pages/kdocs");
const { createHelpPage } = require("../src/cli/tui/pages/help");
const { createTuiServices } = require("../src/cli/tui/tuiServices");
const { buildStatusLines } = require("../src/cli/tui/startTuiRuntime");
const { resolveEscapeKey, translateChar } = require("../src/cli/tui/tuiApp");
const { normalizeCellText, stripAnsi, displayWidth, truncate, fit } = require("../src/cli/tui/width");

// ---- 按键翻译 ----
assert.strictEqual(resolveEscapeKey("\x1b[A"), "up");
assert.strictEqual(resolveEscapeKey("\x1b[B"), "down");
assert.strictEqual(resolveEscapeKey("\x1b[3~"), "delete");
assert.strictEqual(resolveEscapeKey("\x1b[99;5z"), "unknown");
assert.strictEqual(translateChar("\r"), "enter");
assert.strictEqual(translateChar("\x03"), "ctrl-c");

// ---- 纯函数 ----
assert.deepStrictEqual(parseSourceNames("小王, 小王，旺旺01"), ["小王", "旺旺01"]);
assert.strictEqual(storeDate("2026-02-28"), true);
assert.strictEqual(storeDate("2026-02-30"), false);
assert.strictEqual(isSummaryRunning({ summaryRunStartedAt: "x" }), true);
assert.strictEqual(isSummaryRunning({ summaryRunStartedAt: "x", summaryRunFinishedAt: "y" }), false);
assert.strictEqual(normalizeCellText("已发货｜发票..."), "已发货 · 发票");
assert.strictEqual(displayWidth("e\u0301"), 1);
assert.strictEqual(displayWidth("👍🏽"), 2);
assert.strictEqual(displayWidth("👩🏽‍💻"), 2);
assert.strictEqual(displayWidth("…—→"), 3);
assert.strictEqual(stripAnsi(truncate("👩🏽‍💻ABC", 3)), "👩🏽‍💻…");
assert.strictEqual(displayWidth(fit("\x1b[31m👩🏽‍💻e\u0301客户XYZ\x1b[0m", 8)), 8);
assert.doesNotMatch(
  stripAnsi(formatTaskLine({ status: "success", platformLabel: "拼多多｜已发货...", storeDisplayName: "03店...", action: "待处理|跳过..." }, 100)),
  /[|｜│]|\.\.\./
);

// ---- 可注入输出流 ----
function createMockOutput() {
  const chunks = [];
  return {
    columns: 100,
    rows: 30,
    written: "",
    write(text) { chunks.push(text); this.written += text; },
    on() {},
    removeListener() {}
  };
}

// ---- 页面装配（真实配置 + 假服务） ----
async function main() {
const services = createTuiServices({
  readConfig: () => ({
    workbook: { path: "C:/mock/汇总表.xlsx" },
    globalDefaults: {
      exportDateMode: "automatic",
      exportDateAutomation: { endDateDelayDayCount: 2 },
      exportDateRange: { start: { customDate: "2026-08-01" }, end: { customDate: "2026-08-13" } },
      downloadRootDir: "C:/mock/downloads",
      reportProfiles: { performance: { personMappings: [{ summaryName: "小王", role: "售前", sourceNames: ["旺旺01"] }] } }
    },
    tmall: { stores: [{ key: "tmall1", displayName: "天猫一号", includedInSummary: true, username: "u", password: "p", usesGlobalExportDateRange: true, exportDateRange: { start: { customDate: "2026-08-01" }, end: { customDate: "2026-08-13" } }, reportProfiles: {}, downloadDir: "C:/mock/dl" }] },
    jd: { stores: [] },
    pdd: { stores: [] },
    douyin: { stores: [] },
    kdocsDataDetailSync: { documentUrl: "", syncWebhookUrl: "", filterWebhookUrl: "", customerServiceNameWebhookUrl: "" }
  }),
  buildTasks: () => [{ id: "tmall1", platformLabel: "天猫", storeDisplayName: "天猫一号" }],
  getState: () => ({
    lastAction: "", lastError: "", summaryTasks: [], summaryRunStartedAt: "", summaryRunFinishedAt: "", summaryResult: null
  }),
  patchState: () => {},
  subscribeState: () => () => {},
  openPath: async () => {}, openFile: async () => {}, openUrl: async () => {},
  ensureStartupCleanupDone: async () => {},
  runSummaryTask: async () => ({ detail: "mock" }),
  runKdocsDataDetailSync: async () => ({ remoteDataRowCount: 10 }),
  runKdocsPivotEndDateFilterUpdate: async () => ({ filterDate: "2026-08-13", successfulPivotTableCount: 2, pivotTableCount: 2, failedPivotTableCount: 0, failedPivotTables: [] }),
  runKdocsCustomerServiceNameFilterReapply: async () => ({ successfulPivotTableCount: 2, pivotTableCount: 2, failedPivotTableCount: 0, failedPivotTables: [] }),
  refreshExistingPersonRoles: async () => ({ updatedRowCount: 3 }),
  openWorkbookDirectory: async () => {}, openSummaryEvidenceDirectory: async () => {}, openDownloadRootDirectory: async () => {},
  openKdocsScript: async () => {},
  updateProjectConfig: (mutator) => { const config = { globalDefaults: { reportProfiles: { performance: { personMappings: [] } } } }; mutator(config); return config; }
});

const pages = [
  createOverviewPage(),
  createTasksPage(),
  createStorePage(),
  createSettingsPage(),
  createKdocsPage(),
  createHelpPage()
];
const ctx = { services };
pages.forEach((page) => { page.ctx = ctx; });

const output = createMockOutput();
let exitRequestCount = 0;
const app = new TuiApp({
  title: "客服数据自动更新 测试",
  pages,
  output,
  statusBarProvider: (tuiApp) => buildStatusLines(ctx, tuiApp),
  onExitRequest: () => { exitRequestCount += 1; }
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

// 状态栏内容包含汇总状态。
const statusLines = buildStatusLines(ctx, { columns: 100 });
assert.strictEqual(statusLines.length, 2);
assert.ok(statusLines[0].includes("汇总"));

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

// 店铺页多级导航：平台 → 店铺 → 详情。
const storesPage = pages[2];
app.switchPage(2);
app.dispatchKey("enter"); // 进入天猫店铺列表
assert.strictEqual(storesPage.state.mode, "stores");
app.dispatchKey("enter"); // 进入店铺详情
assert.strictEqual(storesPage.state.mode, "store");
app.dispatchKey("down");
app.dispatchKey("esc");
assert.strictEqual(storesPage.state.mode, "stores");
app.dispatchKey("esc");
assert.strictEqual(storesPage.state.mode, "platforms");

// 设置页进入客服编辑器再退出。
const settingsPage = pages[3];
app.switchPage(3);
settingsPage.state.selection = 4; // 客服设置行：日期方式0 延迟1 汇总表2 下载根3 客服4 岗位5
app.dispatchKey("enter");
if (settingsPage.state.personEditor) {
  app.dispatchKey("esc");
  assert.strictEqual(settingsPage.state.personEditor, null);
}

// 总览只显示状态，具体操作由顶部横向分页承载。
const overviewText = stripAnsi(pages[0].render({ ctx, columns: 100 }).join("\n"));
assert.doesNotMatch(overviewText, /快捷操作|开始汇总|强制重新下载|打开汇总文件夹|打开凭证文件夹|打开下载根目录/);
const settingsText = stripAnsi(settingsPage.render({ columns: 100 }).join("\n"));
assert.match(settingsText, /打开汇总文件夹/);
assert.match(settingsText, /打开凭证文件夹/);
assert.match(settingsText, /打开下载根目录/);

// 首页移除快捷操作后，三个唯一文件夹入口仍由设置页调用同一服务层。
const folderCalls = [];
const folderSettingsPage = createSettingsPage();
folderSettingsPage.ctx = {
  services: {
    openWorkbookDirectory: async () => folderCalls.push("workbook"),
    openSummaryEvidenceDirectory: async () => folderCalls.push("evidence"),
    openDownloadRootDirectory: async () => folderCalls.push("downloads")
  }
};
const folderApp = { requestRender() {} };
await folderSettingsPage.executeFieldAction({ id: "openWorkbookDirectory" }, folderApp);
await folderSettingsPage.executeFieldAction({ id: "openSummaryEvidenceDirectory" }, folderApp);
await folderSettingsPage.executeFieldAction({ id: "openDownloadRootDirectory" }, folderApp);
assert.deepStrictEqual(folderCalls, ["workbook", "evidence", "downloads"]);

// 退出确认：ctrl-c 弹确认，n 取消。
app.dispatchKey("ctrl-c");
assert.strictEqual(app.exitConfirmPending, true);
app.dispatchKey("n");
assert.strictEqual(app.exitConfirmPending, false);

// 数字 0 在任意页面都应立即退出，不依赖首页纵向菜单。
app.switchPage(5);
app.dispatchKey("0");
assert.strictEqual(exitRequestCount, 1);
assert.strictEqual(app.exitConfirmPending, false);

console.log("PASS TUI六页面渲染、模态输入/确认、多级导航与退出确认均正常");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
