// 9号项目一键执行：等价 TUI「2 汇总 → S 开始全部汇总」+「5 金山 → 一键同步明细 → 设置透视筛选日期(最新)」。
// 说明：直接调用与界面完全相同的 services 真源，不做任何界面模拟。
// 用法：node scripts/runSummaryAndKdocsSync.js
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const logDir = path.join(projectRoot, 'runtime', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'p4-summary-kdocs.log');
fs.writeFileSync(logFile, `===== 开始 ${new Date().toISOString()} =====\n`);

const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
const tee = (stream, fallback) => (...args) => {
  const text = args.map((a) => (typeof a === 'string' ? a : (() => {
    try { return JSON.stringify(a); } catch (_e) { return String(a); }
  })())).join(' ');
  fs.appendFileSync(logFile, text + '\n');
  (stream || fallback)(...args);
};
console.log = tee(originalLog);
console.error = tee(originalError);

const { readProjectConfig } = require('../src/config/projectConfigServiceParts/projectConfigPersistence');
const { initializeProjectConfigForStartup } = require('../src/config/projectConfigServiceParts/projectConfigInitialization');
const { runConfiguredSummaryTask } = require('../src/cli/cliSummaryTask');
const { syncDataDetailToKdocs } = require('../src/kdocsSync/syncDataDetailToKdocs');
const { updateKdocsPivotEndDateFilter } = require('../src/kdocsSync/updateKdocsPivotEndDateFilter');

function 输出(标题, 内容) {
  console.log(`\n---------- ${标题} ----------`);
  if (内容 !== undefined) console.log(typeof 内容 === 'string' ? 内容 : JSON.stringify(内容, null, 1));
}

async function main() {
  const started = Date.now();

  // 第零步（必需）：等价 TUI/CLI 启动时的配置初始化。
  // 智能模式（exportDateMode=automatic）下，导出日期范围=「本月1号 至 今天-延迟天数」，
  // 这个重算只发生在启动路径（startTuiRuntime.js / cliRuntime.js），跳过它就会沿用
  // 配置里存的旧日期范围，拉到的数据就不是最新的——这里必须显式补上。
  const beforeConfig = readProjectConfig();
  输出('步骤0/3 启动初始化（重算智能模式导出日期范围）', {
    导出日期模式: beforeConfig.globalDefaults?.exportDateMode,
    刷新前范围:
      (beforeConfig.globalDefaults?.exportDateRange?.start?.customDate || '?') +
      ' 至 ' +
      (beforeConfig.globalDefaults?.exportDateRange?.end?.customDate || '?'),
  });
  const initializedConfig = initializeProjectConfigForStartup();
  输出('步骤0 结束（刷新后范围）', {
    刷新后范围:
      (initializedConfig.globalDefaults?.exportDateRange?.start?.customDate || '?') +
      ' 至 ' +
      (initializedConfig.globalDefaults?.exportDateRange?.end?.customDate || '?'),
  });

  // 第一步：汇总菜单 → 开始全部汇总（等价 TUI 汇总页 S 键）。
  输出('步骤1/3 开始全部汇总（全部启用店铺）');
  const summaryResult = await runConfiguredSummaryTask({});
  输出('步骤1 结束', {
    详情: summaryResult?.detail,
    成功: summaryResult?.successCount ?? summaryResult?.completedCount,
    失败: summaryResult?.errorCount,
    跳过: summaryResult?.skippedCount,
  });

  // 第二步：金山菜单 → 一键同步明细（本地“数据明细”全量覆盖在线同名表并回读核对）。
  输出('步骤2/3 金山文档·一键同步明细');
  const syncResult = await syncDataDetailToKdocs({ projectConfig: readProjectConfig() });
  输出('步骤2 结束', {
    在线真实回读行数: syncResult?.remoteDataRowCount,
    清除旧数据多出行数: syncResult?.clearedTailRowCount,
    本地行数: syncResult?.localDataRowCount,
  });

  // 第三步：金山菜单 → 设置透视筛选日期（空字符串 = 取数据最新日期）。
  输出('步骤3/3 金山文档·设置透视筛选日期（回车=数据最新日期）');
  const filterResult = await updateKdocsPivotEndDateFilter({ projectConfig: readProjectConfig(), filterDate: '' });
  输出('步骤3 结束', {
    设定日期: filterResult?.filterDate,
    透视表总数: filterResult?.pivotTableCount,
    成功: filterResult?.successfulPivotTableCount,
    失败: filterResult?.failedPivotTableCount,
    失败明细: filterResult?.failedPivotTables,
  });

  输出('全部完成', { 总耗时秒: Math.round((Date.now() - started) / 1000) });
}

main()
  .then(() => { console.log('P4_RESULT=SUCCESS'); process.exit(0); })
  .catch((error) => {
    console.error('P4 执行失败：' + (error && error.stack ? error.stack : error));
    console.log('P4_RESULT=FAILED');
    process.exit(1);
  });
