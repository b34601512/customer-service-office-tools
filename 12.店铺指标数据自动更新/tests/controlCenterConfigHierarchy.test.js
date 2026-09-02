const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const launchBatch = fs.readFileSync(path.join(projectRoot, "启动控制台.bat"), "utf8");
const cliRuntime = fs.readFileSync(path.join(projectRoot, "src", "cli", "cliRuntime.js"), "utf8");
const cliDashboard = fs.readFileSync(path.join(projectRoot, "src", "cli", "cliDashboard.js"), "utf8");
const cliConfigMenus = fs.readFileSync(path.join(projectRoot, "src", "cli", "cliConfigMenus.js"), "utf8");

test("双击入口和npm入口只启动CLI", () => {
  assert.equal(packageJson.main, "src/cli/startCli.js");
  assert.equal(packageJson.scripts.start, "node src/cli/startCli.js");
  assert.match(launchBatch, /src\\cli\\startCli\.js/);
  assert.doesNotMatch(launchBatch, /controlCenter\\startControlCenter\.js/);
  assert.doesNotMatch(cliRuntime, /startControlCenterServer|launchControlCenterBrowser|127\.0\.0\.1/);
});

test("CLI首页提供运行、强制采集、配置、凭证和文件定位入口", () => {
  for (const menuLabel of ["开始汇总", "强制重新采集", "店铺管理", "日期方式", "汇总表设置", "最近凭证", "打开汇总文件夹", "使用说明"]) {
    assert.ok(cliDashboard.includes(menuLabel), `缺少CLI入口：${menuLabel}`);
  }
  assert.match(cliDashboard, /v0\.01|CLI_VERSION/);
});

test("首页[6]直接打开凭证文件夹，不再进入凭证列表", () => {
  assert.match(cliRuntime, /openRecentEvidenceFolder/);
  assert.match(cliRuntime, /selection === "6"\) await openRecentEvidenceFolder\(\)/);
  assert.doesNotMatch(cliRuntime, /showEvidenceMenu/);
});

test("京东CLI配置支持新增、修改、启停和动态店铺列表", () => {
  assert.match(cliConfigMenus, /addJdStoreConfig/);
  assert.match(cliConfigMenus, /showStoreManagementMenu/);
  assert.match(cliConfigMenus, /runSingleStoreMenu/);
  assert.match(cliConfigMenus, /enabled: store\.enabled === false/);
  assert.match(cliConfigMenus, /修改店铺编号/);
  assert.match(cliConfigMenus, /newKey/);
});

test("店铺管理先选平台再选店铺，天猫和抖音支持独立新增和保存", () => {
  assert.match(cliConfigMenus, /renderPlatformList/);
  assert.match(cliConfigMenus, /showPlatformStoreManagementMenu/);
  assert.match(cliConfigMenus, /addTmallStoreConfig/);
  assert.match(cliConfigMenus, /saveTmallStorePatch/);
  assert.match(cliConfigMenus, /addDouyinStoreConfig/);
  assert.match(cliConfigMenus, /saveDouyinStorePatch/);
  assert.match(cliConfigMenus, /请选择平台/);
});

test("CLI只保留店铺指标方式，不包含客服下载", () => {
  assert.doesNotMatch(`${cliDashboard}\n${cliConfigMenus}`, /客服下载|个人绩效|接待数据/);
  assert.match(cliConfigMenus, /智能修改/);
  assert.match(cliConfigMenus, /手动修改/);
  assert.match(cliConfigMenus, /snapshotDate/);
});

test("CLI不会回显已保存的店铺密码", () => {
  assert.match(cliConfigMenus, /\*\*\*\*\*\*\*\*（已配置）/);
  assert.match(cliConfigMenus, /promptSecret/);
  assert.doesNotMatch(cliConfigMenus, /writeLine\(store\.password\)/);
});
