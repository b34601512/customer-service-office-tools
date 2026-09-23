// 补齐 3 家失败店铺（京东6店 / DEDAKJ拼多多03 / 德达抖音）+ 金山同步明细 + 设置透视筛选日期。
// 用法：node scripts/retryFailedStores.js [任务ID ...]  （缺省=京东6店/拼多多03/德达抖音）
// 说明：与 TUI 完全同一批底层真源；先做启动初始化（重算智能模式导出日期范围），再补采集。
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const logDir = path.join(projectRoot, 'runtime', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'p4-retry-failed.log');
fs.writeFileSync(logFile, `===== 开始 ${new Date().toISOString()} =====\n`);

const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
const tee = (stream) => (...args) => {
  const text = args.map((a) => (typeof a === 'string' ? a : (() => {
    try { return JSON.stringify(a); } catch (_e) { return String(a); }
  })())).join(' ');
  fs.appendFileSync(logFile, text + '\n');
  stream(...args);
};
console.log = tee(originalLog);
console.error = tee(originalError);

const { readProjectConfig } = require('../src/config/projectConfigServiceParts/projectConfigPersistence');
const { initializeProjectConfigForStartup } = require('../src/config/projectConfigServiceParts/projectConfigInitialization');
const { runConfiguredSummaryTask } = require('../src/cli/cliSummaryTask');
const { syncDataDetailToKdocs } = require('../src/kdocsSync/syncDataDetailToKdocs');
const { updateKdocsPivotEndDateFilter } = require('../src/kdocsSync/updateKdocsPivotEndDateFilter');
const { assertSummaryCompleteBeforeKdocsSync } = require('../src/kdocsSync/summaryResultGuard');

const 待补店铺 = process.argv.slice(2).filter((arg) => arg && !arg.startsWith("-"));
if (待补店铺.length === 0) {
  待补店铺.push("jd-jd6-all", "pdd-pdd03-all", "douyin-douyin1-all");
}

function 输出(标题, 内容) {
  console.log(`\n---------- ${标题} ----------`);
  if (内容 !== undefined) console.log(typeof 内容 === 'string' ? 内容 : JSON.stringify(内容, null, 1));
}

async function main() {
  const started = Date.now();

  const 初始化后配置 = initializeProjectConfigForStartup();
  输出('步骤0 启动初始化（智能模式导出日期范围）', {
    范围:
      (初始化后配置.globalDefaults?.exportDateRange?.start?.customDate || '?') +
      ' 至 ' +
      (初始化后配置.globalDefaults?.exportDateRange?.end?.customDate || '?'),
  });

  输出('步骤1/3 补齐失败店铺', { 任务: 待补店铺 });
  const summaryResult = await runConfiguredSummaryTask({ selectedSummaryTaskIds: 待补店铺 });
  输出('步骤1 结束', { 详情: summaryResult?.detail });
  assertSummaryCompleteBeforeKdocsSync(summaryResult);

  输出('步骤2/3 金山文档·一键同步明细');
  const syncResult = await syncDataDetailToKdocs({ projectConfig: readProjectConfig() });
  输出('步骤2 结束', {
    在线真实回读行数: syncResult?.remoteDataRowCount,
    清除旧数据多出行数: syncResult?.clearedTailRowCount,
    本地行数: syncResult?.localDataRowCount,
  });

  输出('步骤3/3 金山文档·设置透视筛选日期（最新）');
  const filterResult = await updateKdocsPivotEndDateFilter({ projectConfig: readProjectConfig(), filterDate: '' });
  输出('步骤3 结束', {
    设定日期: filterResult?.filterDate,
    成功: filterResult?.successfulPivotTableCount,
    失败: filterResult?.failedPivotTableCount,
  });

  输出('全部完成', { 总耗时秒: Math.round((Date.now() - started) / 1000) });
}

main()
  .then(() => { console.log('P4_RETRY=SUCCESS'); process.exit(0); })
  .catch((error) => {
    console.error('重跑失败：' + (error && error.stack ? error.stack : error));
    console.log('P4_RETRY=FAILED');
    process.exit(1);
  });
