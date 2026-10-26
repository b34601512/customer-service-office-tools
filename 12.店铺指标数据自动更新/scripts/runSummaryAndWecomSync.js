// 12号项目一键执行：等价 TUI「2 开始汇总」+「写企业微信《店铺指标数据》子表「数据源」」。
// 说明：直接调用与界面完全相同的 services 真源，不做任何界面模拟。
// 金山链 2026-10-26 已按老板 17:28 令整个删除（无逃生口、无失败回落）。
// 用法：node scripts/runSummaryAndWecomSync.js [--不写表]
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const logDir = path.join(projectRoot, 'runtime', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'p5-summary-wecom.log');
fs.writeFileSync(logFile, `===== 开始 ${new Date().toISOString()} =====\n`);

const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
const tee = (stream, fallback) => (...args) => {
  const text = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (_e) { return String(a); }
  }).join(' ');
  fs.appendFileSync(logFile, text + '\n');
  (stream || fallback)(...args);
};
console.log = tee(originalLog);
console.error = tee(originalError);

const { createControlCenterStateStore } = require('../src/controlCenter/controlCenterState');
const { runConfiguredStoresTask } = require('../src/controlCenter/controlCenterTask');
const { readStoreMetricConfig } = require('../src/config/storeMetricConfig');
const { syncDataSourceToWecom } = require('./写企微数据源');

function 输出(标题, 内容) {
  console.log(`\n---------- ${标题} ----------`);
  if (内容 !== undefined) console.log(typeof 内容 === 'string' ? 内容 : JSON.stringify(内容, null, 1));
}

async function main() {
  const started = Date.now();

  // 第一步：菜单2「开始汇总」（全部启用平台店铺，按顺序执行）。
  输出('步骤1/2 开始汇总（全部启用店铺）');
  const stateStore = createControlCenterStateStore();
  let 上次日志 = '';
  const unsubscribe = stateStore.subscribe((state) => {
    const line = `[${state.status}] ${state.stage || ''} · ${state.detail || ''}`;
    if (line !== 上次日志 && state.status === 'running') {
      上次日志 = line;
      console.log(line);
    }
  });
  let 汇总错误 = '';
  try {
    await runConfiguredStoresTask(stateStore, {});
  } catch (error) {
    汇总错误 = String((error && error.message) || error);
    console.log('步骤1 异常：' + 汇总错误);
  } finally {
    unsubscribe();
  }
  const 最终状态 = stateStore.read();
  const 店铺结果 = (最终状态.storeResults || []).map((s) => ({
    平台: s.platformKey,
    店铺: s.storeName,
    状态: s.status,
    指标数: s.metricCount,
    说明: s.detail,
  }));
  输出('步骤1 结束', {
    任务状态: 最终状态.status,
    结果说明: 最终状态.detail,
    店铺明细: 店铺结果,
    成功: 店铺结果.filter((s) => s.状态 === 'success').length,
    跳过: 店铺结果.filter((s) => s.状态 === 'skipped').length,
    失败: 店铺结果.filter((s) => s.状态 === 'error').length,
  });

  // 第二步：写企业微信《店铺指标数据》子表「数据源」（先删同批次旧行 → 写 → 回读两层）。
  if (process.argv.includes('--不写表')) {
    输出('步骤2/2 跳过写企微（--不写表）');
  } else {
    输出('步骤2/2 写企业微信·数据源');
    const syncResult = await syncDataSourceToWecom({ submit: true });
    输出('步骤2 结束', syncResult);
  }

  输出('全部完成', { 总耗时秒: Math.round((Date.now() - started) / 1000) });
  if (汇总错误) {
    console.log('P5_RESULT=PARTIAL（汇总阶段有异常，表照写：' + 汇总错误 + '）');
    process.exit(1);
  }
}

main()
  .then(() => { console.log('P5_RESULT=SUCCESS'); process.exit(0); })
  .catch((error) => {
    console.error('P5 执行失败：' + (error && error.stack ? error.stack : error));
    console.log('P5_RESULT=FAILED');
    process.exit(1);
  });
