// 京东 3 家店铺「先登录、后采集」一键脚本。
//
// 为什么需要它：京东安全验证（滑块/扫码）必须人工完成，而采集流程内置的
// 人工等待窗口只有 15 分钟，人不在电脑前就会整店失败。本脚本把两件事拆开：
//   阶段A：逐店打开可见浏览器，不限时等你完成登录（默认每店 30 分钟），登录成功后关闭该店浏览器
//          （登录态已落盘到该店自己的资料目录，后续采集可直接复用）；
//   阶段B：用与 TUI 完全相同的真源补齐 3 家京东店铺汇总；
//   阶段C：金山文档同步明细 + 设置透视筛选日期（最新）。
//
// 用法：node scripts/preloginJdThenCollect.js（等价能力已并入 TUI 之外的直调入口）
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const logDir = path.join(projectRoot, 'runtime', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'p4-jd-prelogin.log');
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

const {
  waitForChromeDebugPortReady,
  connectToChrome,
  readManagedChromeSession,
  closeManagedChrome,
} = require('../src/engine/chromeSession');
const { resolveManagedOpenWindowMeta, runManagedOpenWindowEngine } = require('../src/shared/managedOpenWindowEngine');
const { isJdLoginReady } = require('../src/platforms/jd/jdLoginPageClassifier');
const { JD_SYSTEM_RECEPTION_DATA_URL } = require('../src/platforms/jd/jdUrlRules');
const { readProjectConfig } = require('../src/config/projectConfigServiceParts/projectConfigPersistence');
const { buildConfiguredSummaryTasks } = require('../src/controlCenter/summaryTaskPlanner');
const { runConfiguredSummaryTask } = require('../src/cli/cliSummaryTask');
const { syncDataDetailToKdocs } = require('../src/kdocsSync/syncDataDetailToKdocs');
const { updateKdocsPivotEndDateFilter } = require('../src/kdocsSync/updateKdocsPivotEndDateFilter');

const 每店等待上限毫秒 = Number(process.env.JD_PRELOGIN_LIMIT_MS) || 30 * 60 * 1000;

function 输出(标题, 内容) {
  console.log(`\n---------- ${标题} ----------`);
  if (内容 !== undefined) console.log(typeof 内容 === 'string' ? 内容 : JSON.stringify(内容, null, 1));
}

function 取京东店铺配置() {
  const cfg = readProjectConfig();
  // 京东系统后台目标页真源：src/platforms/jd/jdUrlRules.js 的 JD_SYSTEM_RECEPTION_DATA_URL。
  const stores = ((cfg.jd || {}).stores || []).filter((s) => s.enabled !== false && s.includedInSummary !== false);
  return stores.map((store) => ({
    ...store,
    key: store.key,
    displayName: store.displayName || store.key,
    siteUrl: store.siteUrl || JD_SYSTEM_RECEPTION_DATA_URL,
  }));
}

async function 读取登录状态() {
  // 只读取当前受控浏览器里的京东页面登录状态，不做任何点击。
  let browser = null;
  try {
    if (!(await waitForChromeDebugPortReady({ timeoutMs: 3000, pollIntervalMs: 300 }))) {
      return { ready: false, reason: '调试端口未就绪' };
    }
    browser = await connectToChrome();
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const page of pages) {
      const url = String(page.url() || '');
      if (!/jd\.com/i.test(url)) continue;
      if (await isJdLoginReady(page)) {
        return { ready: true, reason: `已登录：${url}` };
      }
    }
    return { ready: false, reason: '尚未确认登录成功' };
  } catch (error) {
    return { ready: false, reason: '读取登录状态失败：' + String(error && error.message) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function 等待人工登录(store) {
  const deadline = Date.now() + 每店等待上限毫秒;
  let 上次提示 = 0;
  while (Date.now() < deadline) {
    const 状态 = await 读取登录状态();
    if (状态.ready) {
      console.log(`✅ 「${store.displayName}」登录成功：${状态.reason}`);
      return true;
    }
    if (Date.now() - 上次提示 > 30000) {
      上次提示 = Date.now();
      const 剩余分钟 = Math.ceil((deadline - Date.now()) / 60000);
      console.log(`⏳ 等待「${store.displayName}」登录中…（还需 ${状态.reason}；剩余等待上限 ${剩余分钟} 分钟）`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log(`⌛ 「${store.displayName}」等待超时，先跳过（采集阶段会再尝试一次）。`);
  return false;
}

async function 逐店预登录(stores) {
  const 结果 = {};
  for (const store of stores) {
    输出(`阶段A 预登录：${store.displayName}`);
    console.log('请在弹出的 Chrome 窗口中完成登录：');
    console.log('  1) 用京东APP扫码登录（最快），或点「密码登录」输入账号密码；');
    console.log('  2) 如出现「安全验证」滑块，请拖完；');
    console.log('  3) 登录成功后本脚本会自动关闭窗口并进入下一家店。');
    const openMeta = resolveManagedOpenWindowMeta(store);
    await runManagedOpenWindowEngine({
      platformKey: 'jd',
      browserMode: 'headed',
      storeConfig: store,
      openMeta,
      actionName: '预登录打开京东店铺窗口',
      moduleName: '京东预登录',
      missingOpenUrlMessage: `京东店铺「${store.displayName}」缺少后台目标页。`,
    });
    结果[store.key] = await 等待人工登录(store);
    // 登录态已落盘，关掉窗口释放 9333，避免影响下一家店。
    await closeManagedChrome().catch((error) => {
      console.log('关闭浏览器时提示（可忽略）：' + String(error && error.message));
    });
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 结果;
}

async function main() {
  const started = Date.now();
  const stores = 取京东店铺配置();
  输出('待预登录的京东店铺', stores.map((s) => `${s.displayName}（${s.key}）`));
  if (!stores.length) throw new Error('没有启用中的京东店铺。');

  const 登录结果 = await 逐店预登录(stores);
  输出('阶段A 结果', 登录结果);

  // 调试开关：只做预登录，不跑采集与金山同步。
  if (process.env.JD_PRELOGIN_ONLY === '1') {
    输出('已开启 JD_PRELOGIN_ONLY，跳过阶段B/C');
    return;
  }

  const tasks = buildConfiguredSummaryTasks(readProjectConfig());
  const 京东任务 = tasks.filter((t) => t.platformKey === 'jd').map((t) => t.id);
  输出('阶段B 补齐京东汇总', { 任务: 京东任务 });
  const summaryResult = await runConfiguredSummaryTask({ selectedSummaryTaskIds: 京东任务 });
  输出('阶段B 结束', { 详情: summaryResult?.detail });

  输出('阶段C-1 金山文档·一键同步明细');
  const syncResult = await syncDataDetailToKdocs({ projectConfig: readProjectConfig() });
  输出('阶段C-1 结束', {
    在线真实回读行数: syncResult?.remoteDataRowCount,
    清除旧数据多出行数: syncResult?.clearedTailRowCount,
    本地行数: syncResult?.localDataRowCount,
  });

  输出('阶段C-2 金山文档·设置透视筛选日期（最新）');
  const filterResult = await updateKdocsPivotEndDateFilter({ projectConfig: readProjectConfig(), filterDate: '' });
  输出('阶段C-2 结束', {
    设定日期: filterResult?.filterDate,
    成功: filterResult?.successfulPivotTableCount,
    失败: filterResult?.failedPivotTableCount,
  });

  输出('全部完成', { 总耗时秒: Math.round((Date.now() - started) / 1000) });
}

main()
  .then(() => { console.log('P4_JD_PRELOGIN=SUCCESS'); process.exit(0); })
  .catch((error) => {
    console.error('预登录脚本失败：' + (error && error.stack ? error.stack : error));
    console.log('P4_JD_PRELOGIN=FAILED');
    process.exit(1);
  });
