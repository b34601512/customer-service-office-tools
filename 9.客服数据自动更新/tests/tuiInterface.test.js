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

// 总览页承载快捷操作菜单（#630 反转首版“总览只展示”决策：用户要求对齐1号“↑↓选择 回车执行”）。
const { getSummaryRunController } = require("../src/cli/tui/pages/summaryRunActions");
const runController = getSummaryRunController();
const overviewText = stripAnsi(pages[0].render({ ctx, columns: 100 }).join("\n"));
assert.match(overviewText, /快捷操作（↑↓选择 回车执行）/);
assert.match(overviewText, /开始全部汇总/);
assert.match(overviewText, /全部强制重新下载并汇总/);
assert.match(overviewText, /退出程序/);
assert.doesNotMatch(overviewText, /打开汇总文件夹|打开凭证文件夹|打开下载根目录/); // 文件夹入口仍唯一归设置页
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

// ---- #630 总览页菜单键盘驱动：↑↓选择、回车执行 ----
async function waitFor(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

const runCalls = [];
services.runSummaryTask = async (options) => {
  runCalls.push(options);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { detail: "mock汇总完成" };
};

app.switchPage(0);
pages[0].state.selection = 0;
app.dispatchKey("enter"); // 第1项：开始全部汇总，无确认直接执行
assert.ok(await waitFor(() => runCalls.length === 1), "回车应触发 runSummaryTask");
assert.deepStrictEqual(runCalls[0], { selectedSummaryTaskIds: null, forceRedownload: false });
assert.ok(await waitFor(() => app.currentPageIndex === 1), "启动后应自动跳到汇总页看进度");
app.switchPage(0);
assert.ok(await waitFor(() => !runController.busy), "运行结束后 busy 应复位");
assert.strictEqual(runController.message, "mock汇总完成");

// 第2项：全部强制重下，回车先弹确认，y 确认后带 force 参数执行并同样跳汇总页。
pages[0].state.selection = 1;
app.dispatchKey("enter");
assert.ok(app.inputModal && app.inputModal.mode === "confirm", "应弹出确认框");
app.dispatchKey("y");
assert.ok(await waitFor(() => runCalls.length === 2), "确认 y 后应触发强制汇总");
assert.strictEqual(runCalls[1].forceRedownload, true);
assert.ok(await waitFor(() => app.currentPageIndex === 1), "强制汇总启动后也应自动跳汇总页");
app.switchPage(0);
assert.ok(await waitFor(() => !runController.busy));

// 取消确认则不执行、不跳页。
pages[0].state.selection = 1;
app.dispatchKey("enter");
assert.ok(app.inputModal && app.inputModal.mode === "confirm");
app.dispatchKey("n");
await new Promise((resolve) => setTimeout(resolve, 30));
assert.strictEqual(runCalls.length, 2);
assert.strictEqual(runController.busy, false);
assert.strictEqual(app.currentPageIndex === 0, true, "取消后应留在总览页");

// 运行中菜单置灰禁用：回车只提示，不重复触发服务、不跳页；退出项仍可用。
runController.busy = true;
const busyOverview = stripAnsi(pages[0].render(app).join("\n"));
assert.match(busyOverview, /汇总运行中，暂不可执行/);
assert.match(busyOverview, /退出程序/, "退出项运行中仍应可见");
assert.doesNotMatch(busyOverview, /退出程序（汇总运行中/, "退出项运行中不得置灰");
const callsBeforeBusyBlock = runCalls.length;
pages[0].state.selection = 0;
app.dispatchKey("enter");
assert.strictEqual(runCalls.length, callsBeforeBusyBlock, "运行中回车不得触发新汇总");
// 运行中退出项仍可用：回车直接退出（与数字0同一路径），不二次确认。
pages[0].state.selection = 2;
app.dispatchKey("enter");
assert.strictEqual(exitRequestCount, 2, "菜单退出应直接触发 onExitRequest");
assert.strictEqual(app.exitConfirmPending, false, "菜单退出不走确认流");
runController.busy = false;
runController.message = "";

// 汇总页提示行同步新口径：S/F 保留为快捷键。
const tasksText = stripAnsi(pages[1].render(app).join("\n"));
assert.match(tasksText, /S 开始全部汇总/);
assert.match(tasksText, /F 全部强制重下/);

console.log("PASS TUI六页面渲染、模态输入/确认、多级导航、退出确认与总览快捷操作菜单均正常");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
