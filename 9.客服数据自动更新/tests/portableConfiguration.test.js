// 仅针对打包脚本提供的独立解压目录操作，绝不读写开发者配置。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(process.argv[2] || "");
assert.notEqual(root, path.resolve(__dirname, ".."), "必须传入独立解压后的应用目录");
assert.ok(root.includes("打包校验"), "仅允许在打包校验目录验证");
process.env.CUSTOMER_PERFORMANCE_SUPPRESS_CONSOLE_LOG = "1";
const fromApp = (file) => require(path.join(root, file));
const { TuiApp } = fromApp("src/cli/tui/tuiApp.js");
const { stripAnsi } = fromApp("src/cli/tui/width.js");
const { createSettingsPage } = fromApp("src/cli/tui/pages/settings.js");
const { createStorePage } = fromApp("src/cli/tui/pages/stores.js");
const { createKdocsPage } = fromApp("src/cli/tui/pages/kdocs.js");
const { readProjectConfig } = fromApp("src/config/projectConfigServiceParts/projectConfigPersistence.js");
const { initializeProjectConfigForStartup } = fromApp("src/config/projectConfigServiceParts/projectConfigInitialization.js");
const { updateProjectConfig } = fromApp("src/cli/cliProjectConfig.js");
const appConfig = fromApp("src/config/appConfig.js");
assert.equal(appConfig.projectRoot, root);

async function main() {
  initializeProjectConfigForStartup();
  const pages = [createSettingsPage(), createStorePage(), createKdocsPage()];
  const services = { readConfig: readProjectConfig, updateProjectConfig };
  const ctx = { services };
  pages.forEach(page => { page.ctx = ctx; });
  const app = new TuiApp({ pages, output: { columns: 60, rows: 20, write() {}, on() {} } });
  app.ctx = ctx;
  const [settings, stores, kdocs] = pages;

  let pending = app.requestInput({ title: "岗位", defaultValue: "1" });
  app.consumeInput(Buffer.from("2\r"));
  assert.equal(await pending, "2", "输入2应替换默认1，而不是变成12");
  pending = app.requestInput({ title: "默认值", defaultValue: "2" });
  app.dispatchKey("enter");
  assert.equal(await pending, "2");
  pending = app.requestInput({ title: "中文路径" });
  const bytes = Buffer.from("主管😀目录");
  for (const byte of bytes) app.consumeInput(Buffer.from([byte]));
  app.dispatchKey("enter");
  assert.equal(await pending, "主管😀目录");
  pending = app.requestInput({ title: "很长的当前路径".repeat(15) });
  app.consumeInput(Buffer.from("D:/" + "目录/".repeat(40) + "汇总.xlsx"));
  assert.match(stripAnsi(app.buildFrame().join("\n")), /汇总\.xlsx▏/);
  app.dispatchKey("esc");
  assert.equal(await pending, null);
  pending = app.requestInput({ title: "密码", secret: true });
  app.consumeInput(Buffer.from("private-token"));
  assert.doesNotMatch(app.buildFrame().join("\n"), /private-token/);
  app.dispatchKey("esc");
  await pending;

  // 实际输入模态框驱动各页，保存使用真正的业务校验和文件持久化。
  const requestInput = app.requestInput.bind(app);
  let answers = [];
  app.requestInput = options => {
    assert.ok(answers.length, `缺少输入：${options.title}`);
    const value = answers.shift();
    const promise = requestInput(options);
    queueMicrotask(() => {
      if (value === null) app.dispatchKey("esc");
      else { app.consumeInput(Buffer.from(value)); app.dispatchKey("enter"); }
    });
    return promise;
  };
  async function input(values, action) {
    answers = values.slice();
    await action();
    assert.equal(answers.length, 0);
  }
  const xlsx = require(require.resolve("xlsx", { paths: [root] }));
  const workbookPath = path.join(root, "测试 汇总.xlsx");
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([["测试"]]), "数据明细");
  xlsx.writeFile(workbook, workbookPath);
  await input([`"${workbookPath}"`], () => settings.executeFieldAction({ id: "workbookPath" }, app));
  assert.equal(readProjectConfig().workbook.path, workbookPath);
  const downloadRoot = path.join(root, "测试 下载");
  await input([downloadRoot], () => settings.executeFieldAction({ id: "downloadRoot" }, app));
  for (const platform of ["tmall", "jd", "pdd", "douyin"]) {
    for (const store of readProjectConfig()[platform].stores) assert.ok(store.downloadDir.startsWith(downloadRoot + path.sep));
  }
  await input(["2026-08-01", "2026-08-31"], () => settings.executeFieldAction({ id: "dateMode" }, app));
  assert.equal(readProjectConfig().globalDefaults.exportDateMode, "manual");
  await input(["2026-02-30"], () => settings.executeFieldAction({ id: "manualStart" }, app));
  assert.match(settings.state.message, /无效/);
  assert.equal(readProjectConfig().globalDefaults.exportDateRange.start.customDate, "2026-08-01");

  await settings.executeFieldAction({ id: "personMappings" }, app);
  await input(["客服甲", "2", "账号甲，账号甲备用"], () => settings.editPersonMapping(app, -1));
  assert.equal(readProjectConfig().globalDefaults.reportProfiles.performance.personMappings[0].role, "售后");
  await input(["客服乙", "1", "账号甲"], () => settings.editPersonMapping(app, -1));
  assert.equal(settings.state.personEditor.mappings.length, 1, "保存被拒绝不得污染编辑名单");
  assert.match(stripAnsi(app.buildFrame().join("\n")), /提示：/);
  await input(["客服乙", "1", "账号乙"], () => settings.editPersonMapping(app, -1));
  assert.equal(readProjectConfig().globalDefaults.reportProfiles.performance.personMappings.length, 2);
  // 只改变界面测试数据，验证较长名单选中项与错误提示同时可见。
  const savedMappings = settings.state.personEditor.mappings;
  settings.state.personEditor.mappings = Array.from({ length: 40 }, (_, index) => ({ summaryName: `客服${index}`, role: "售前", sourceNames: [`账号${index}`] }));
  settings.state.personEditor.selection = 39;
  settings.state.message = "测试保存错误";
  const frame = stripAnsi(app.buildFrame().join("\n"));
  assert.match(frame, /客服39/);
  assert.match(frame, /测试保存错误/);
  settings.state.personEditor.mappings = savedMappings;
  settings.state.personEditor.selection = 0;
  const saveMappings = settings.savePersonMappings;
  settings.savePersonMappings = () => { throw new Error("测试写入失败"); };
  settings.handlePersonEditorKey("d", app);
  app.dispatchKey("y");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.state.personEditor.mappings.length, 2);
  assert.match(settings.state.message, /测试写入失败/);
  settings.savePersonMappings = saveMappings;

  app.switchPage(1);
  for (const platform of ["tmall", "jd", "pdd", "douyin"]) {
    stores.state.platformKey = platform;
    stores.state.mode = "stores";
    stores.handleKey("a", app);
    const key = stores.state.storeKey;
    const edit = (id, values) => input(values, () => stores.executeStoreAction({ id }, app, stores.findCurrentStore()));
    await edit("name", [`测试${platform}店铺`]);
    await edit("username", [`测试${platform}账号`]);
    await edit("password", ["Test#Password123"]);
    assert.equal(readProjectConfig()[platform].stores.find(store => store.key === key).username, `测试${platform}账号`);
    if (platform === "jd") {
      await edit("jdScope", ["2", "售前组，售后组"]);
      assert.deepEqual(stores.findCurrentStore().customerServiceScope, { mode: "客服组", values: ["售前组", "售后组"] });
      await edit("jdScope", ["1", null]);
      assert.equal(stores.findCurrentStore().customerServiceScope.mode, "客服组");
    }
    if (platform === "douyin") {
      await edit("douyinId", ["123456"]);
      await edit("douyinName", ["测试抖店"]);
      assert.equal(stores.findCurrentStore().platformStoreId, "123456");
    }
    if (platform === "pdd") {
      await edit("username", ["13800000000"]);
      await edit("pddIdentity", ["测试拼多多旗舰店"]);
      const store = stores.findCurrentStore();
      assert.equal(store.expectedIdentityText, "测试拼多多旗舰店");
      const { buildPddStoreIdentityStatus } = fromApp("src/platforms/pdd/pddStoreIdentity.js");
      assert.equal(buildPddStoreIdentityStatus("当前店铺 测试拼多多旗舰店", store).identityMatched, true);
      assert.equal(buildPddStoreIdentityStatus("当前店铺 其他旗舰店", store).identityMatched, false);
    }
  }
  app.switchPage(2);
  kdocs.state.selection = 7;
  kdocs.state.message = "测试配置错误";
  assert.match(stripAnsi(app.buildFrame().join("\n")), /打开客服姓名脚本/);
  assert.match(stripAnsi(app.buildFrame().join("\n")), /测试配置错误/);
  const webhook = "https://www.kdocs.cn/api/v3/ide/file/test/script/test/sync_task";
  await input(["https://www.kdocs.cn/l/test", webhook, "test-sync", webhook, "test-filter", webhook, "test-names"], () => kdocs.editSyncSettings(app));
  assert.equal(readProjectConfig().kdocsDataDetailSync.customerServiceNameApiToken, "test-names");
  await input(["", null], () => kdocs.editSyncSettings(app));
  assert.equal(readProjectConfig().kdocsDataDetailSync.syncApiToken, "test-sync");
  for (const name of ["AirScript-同步数据明细.txt", "AirScript-筛选透视结果.txt", "AirScript-原样确认客服姓名勾选.txt"]) {
    assert.ok(fs.statSync(path.join(root, "src/kdocsSync", name)).size > 0);
  }

  const expected = readProjectConfig();
  const restart = spawnSync(process.execPath, ["-e", `
    process.env.CUSTOMER_PERFORMANCE_SUPPRESS_CONSOLE_LOG = "1";
    require("./src/config/projectConfigServiceParts/projectConfigInitialization").initializeProjectConfigForStartup();
    process.stdout.write(JSON.stringify(require("./src/config/projectConfigServiceParts/projectConfigPersistence").readProjectConfig()));
  `], { cwd: root, env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" }, encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(restart.status, 0, restart.stderr);
  assert.deepEqual(JSON.parse(restart.stdout), expected, "重启后配置必须保持一致");
  console.log("PASS: 独立包配置输入、四平台新增与凭证、路径、日期、人员冲突恢复、京东范围、金山设置与重启回读");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
