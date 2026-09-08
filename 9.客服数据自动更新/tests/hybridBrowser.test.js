const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveBrowserMode, resolveHumanTimeoutMs, isBrowserModeCompatible, getAutomationScope,
  runInAutomationScope, requireHeadedBrowser, registerAutomationBrowser,
  assertAutomationActive, markExportAttempted
} = require('../src/engine/browserAutomationScope');
const { runHybridSourceDownload } = require('../src/summary/storeSummaryParts/hybridSourceRunner');
const { buildManagedChromeLaunchArgs } = require('../src/engine/chromeLaunchArgs');
const { isKnownAdUrl, buildMarketingSelectors } = require('../src/engine/browserPopupGuard');
const {
  isPlatformUrl, isLoginUrl, detectHumanRequirement, checkBrowserHumanRequirement, waitForHumanResolution
} = require('../src/engine/browserHumanGuard');
const { requestChromeCloseOverCDP } = require('../src/engine/chromeSessionParts/chromeHeadlessCloser');
const { waitForDownloadArtifactState } = require('../src/shared/downloadEventEngine');
const { dismissBlockingPopups } = require('../src/shared/blockingPopupEngine');

const launchOptions = { remoteDebuggingPort: 9333, userDataDir: 'C:\\fixture-profile', targetUrl: 'https://example.test/' };
function options(extra = {}) { return { platformKey: 'jd', mode: 'hybrid', headless: true, openHeaded: async () => {}, isShutdownRequested: () => false, ...extra }; }
function scope(extra = {}) { return { platformKey: 'jd', headless: true, humanTimeoutMs: 1000, isShutdownRequested: () => false, ...extra }; }
function locator(visible = false) { return { count: async () => visible ? 1 : 0, nth: () => ({ isVisible: async () => visible }) }; }
function fakePage({ url = 'https://kf.jd.com/report', challenge = false, password = false, frame = null } = {}) {
  const page = {
    url: () => url, isClosed: () => false, bringToFront: async () => {},
    frames: () => frame ? [frame] : [],
    getByText: expression => locator(challenge && expression.test('请完成安全验证')),
    locator: selector => locator(password && selector.includes('password'))
  };
  return page;
}
function browserFor(page) { return { contexts: () => [{ pages: () => [page] }] }; }

test('modes and limits validate rather than silently accepting typos', () => {
  assert.equal(resolveBrowserMode(''), 'hybrid');
  for (const mode of ['hybrid', 'headed', 'headless']) assert.equal(resolveBrowserMode(mode), mode);
  assert.throws(() => resolveBrowserMode('headles'), /模式无效/);
  assert.equal(resolveHumanTimeoutMs('1000'), 1000);
  assert.equal(resolveHumanTimeoutMs(''), 180000);
  for (const bad of ['NaN', '1.5', '0', '-1', '900001']) assert.throws(() => resolveHumanTimeoutMs(bad), /整数毫秒/);
});
test('explicit modes reject incompatible old browser but hybrid keeps a visible handoff', () => {
  assert.equal(isBrowserModeCompatible({ headless: true }, 'headed'), false);
  assert.equal(isBrowserModeCompatible({}, 'headless'), false);
  assert.equal(isBrowserModeCompatible({ headless: false }, 'hybrid'), true);
});
test('manual launch remains visible, headless gets fixed viewport and popup allow is opt-in', () => {
  const manual = buildManagedChromeLaunchArgs(launchOptions);
  assert.ok(manual.includes('--new-window'));
  assert.equal(manual.some(arg => arg.startsWith('--headless')), false);
  assert.equal(manual.includes('--disable-popup-blocking'), false);
  const hidden = buildManagedChromeLaunchArgs({ ...launchOptions, headless: true });
  assert.ok(hidden.includes('--headless=new'));
  assert.ok(hidden.includes('--window-size=1440,1000'));
  assert.equal(hidden.includes('--new-window'), false);
  assert.ok(buildManagedChromeLaunchArgs({ ...launchOptions, allowPopups: true }).includes('--disable-popup-blocking'));
});
test('successful headless source executes exactly once', async () => {
  let calls = 0;
  assert.equal(await runHybridSourceDownload(options(), async () => { calls++; return 'report.xlsx'; }), 'report.xlsx');
  assert.equal(calls, 1);
});
test('human handoff waits for finally, reopens once and retries only the source', async () => {
  const events = []; let calls = 0;
  const result = await runHybridSourceDownload(options({ openHeaded: async () => events.push('open') }), async () => {
    calls++;
    try { requireHeadedBrowser('短信验证'); return 'report.xlsx'; }
    finally { events.push(`cleanup-${calls}`); }
  });
  assert.equal(result, 'report.xlsx');
  assert.equal(calls, 2);
  assert.deepEqual(events, ['cleanup-1', 'open', 'cleanup-2']);
});
test('wrapped errors retain scoped human marker without depending on message parsing', async () => {
  let calls = 0;
  await runHybridSourceDownload(options(), async () => {
    calls++;
    try { requireHeadedBrowser('验证码'); }
    catch (error) { throw new Error(`platform wrapper: ${error.message}`); }
  });
  assert.equal(calls, 2);
});
test('ordinary failure is not blindly retried', async () => {
  let reopened = 0; let calls = 0;
  await assert.rejects(runHybridSourceDownload(options({ openHeaded: async () => reopened++ }), async () => {
    calls++; throw new Error('schema mismatch');
  }), /schema mismatch/);
  assert.equal(reopened, 0); assert.equal(calls, 1);
});
test('strict headless reports intervention without opening a window', async () => {
  let reopened = 0;
  await assert.rejects(runHybridSourceDownload(options({ mode: 'headless', openHeaded: async () => reopened++ }), async () => {
    requireHeadedBrowser('登录');
  }), { code: 'HEADLESS_REQUIRES_HUMAN' });
  assert.equal(reopened, 0);
});
test('possibly submitted export opens a visible window but never replays', async () => {
  let calls = 0; let reopened = 0;
  await assert.rejects(runHybridSourceDownload(options({ openHeaded: async () => reopened++ }), async () => {
    calls++; markExportAttempted(); requireHeadedBrowser('下载期间验证码');
  }), { code: 'EXPORT_OUTCOME_UNCERTAIN' });
  assert.equal(calls, 1); assert.equal(reopened, 1);
});
test('handoff startup failure propagates and does not restart source', async () => {
  let calls = 0;
  await assert.rejects(runHybridSourceDownload(options({ openHeaded: async () => { throw new Error('port occupied'); } }), async () => {
    calls++; requireHeadedBrowser('验证');
  }), /port occupied/);
  assert.equal(calls, 1);
});
test('shutdown does not launch another browser', async () => {
  let stopping = false; let reopened = 0;
  await assert.rejects(runHybridSourceDownload(options({ isShutdownRequested: () => stopping, openHeaded: async () => reopened++ }), async () => {
    stopping = true; requireHeadedBrowser('验证');
  }), { code: 'BROWSER_RUN_CANCELLED' });
  assert.equal(reopened, 0);
});
test('separate source scopes do not leak export or intervention flags', async () => {
  const results = await Promise.all([
    runInAutomationScope(scope(), async () => { markExportAttempted(); await Promise.resolve(); return getAutomationScope().exportAttempted; }),
    runInAutomationScope(scope(), async () => { await Promise.resolve(); return !!getAutomationScope().exportAttempted; })
  ]);
  assert.deepEqual(results, [true, false]); assert.equal(getAutomationScope(), undefined);
});
test('orphan asynchronous work observes completed scope and stops', async () => {
  let orphan;
  await runInAutomationScope(scope(), async () => {
    orphan = new Promise(resolve => setTimeout(() => {
      try { assertAutomationActive(); resolve('continued'); } catch (e) { resolve(e.code); }
    }, 10));
  });
  assert.equal(await orphan, 'BROWSER_RUN_CANCELLED');
});
test('host matching cannot accept suffix-spoofed login or ad domains', () => {
  assert.equal(isPlatformUrl('https://passport.jd.com/login', 'jd'), true);
  assert.equal(isPlatformUrl('https://passport.jd.com.evil.test/login', 'jd'), false);
  assert.equal(isLoginUrl('https://kf.jd.com/report?login=1', 'jd'), false);
  assert.equal(isLoginUrl('https://passport.jd.com/new/login.aspx', 'jd'), true);
  assert.equal(isKnownAdUrl('https://ad.doubleclick.net/ad'), true);
  for (const url of ['https://doubleclick.net.evil.test/ad', 'https://passport.jd.com/login', 'about:blank', 'blob:https://kf.jd.com/example', 'https://kf.jd.com/export']) assert.equal(isKnownAdUrl(url), false);
  const selectors = buildMarketingSelectors().join(',');
  for (const phrase of ['安全验证', '确认导出', '切换店铺', '授权']) assert.ok(selectors.includes(`:not(:has-text("${phrase}"))`));
});
test('detects visible passwords and iframe challenges but ignores ordinary login help text', async () => {
  assert.equal(await detectHumanRequirement(fakePage(), { platformKey: 'jd', includeLogin: true }), '');
  assert.match(await detectHumanRequirement(fakePage({ password: true }), { platformKey: 'jd', includeLogin: true }), /登录/);
  assert.equal(await detectHumanRequirement(fakePage({ password: true }), { platformKey: 'jd', includeLogin: false }), '');
  const frame = fakePage({ challenge: true });
  assert.match(await detectHumanRequirement(fakePage({ frame }), { platformKey: 'jd' }), /安全验证/);
  assert.equal(await detectHumanRequirement(fakePage({ url: 'https://example.test', challenge: true }), { platformKey: 'jd' }), '');
});
test('headless guard requests handoff during polling as well as clicking', async () => {
  await assert.rejects(runInAutomationScope(scope(), async () => {
    registerAutomationBrowser(browserFor(fakePage({ challenge: true })));
    await checkBrowserHumanRequirement({ force: true });
  }), { code: 'BROWSER_NEEDS_HUMAN' });
});
test('headed human wait continues only after challenge disappears, bounded by a timeout', async () => {
  let clock = 0; let blocked = true;
  await runInAutomationScope(scope({ headless: false, now: () => clock, wait: async ms => { clock += ms; blocked = false; } }), async () => {
    assert.equal(await waitForHumanResolution(fakePage(), '测试验证', async () => blocked), true);
  });
  clock = 0;
  await assert.rejects(runInAutomationScope(scope({ headless: false, now: () => clock, wait: async ms => { clock += ms; } }), () =>
    waitForHumanResolution(fakePage(), '测试验证', async () => true)
  ), /等待人工验证超时/);
});
test('graceful headless close sends Browser.close, not just a client disconnect', async () => {
  const calls = [];
  const connect = async () => ({
    newBrowserCDPSession: async () => ({ send: async command => calls.push(command) }),
    close: async () => calls.push('disconnect')
  });
  assert.equal(await requestChromeCloseOverCDP('http://127.0.0.1:9333', { connect }), true);
  assert.deepEqual(calls, ['Browser.close', 'disconnect']);
});
test('graceful close accepts expected connection loss but not an unknown CDP error', async () => {
  const make = message => async () => ({
    newBrowserCDPSession: async () => ({ send: async () => { throw new Error(message); } }), close: async () => {}
  });
  assert.equal(await requestChromeCloseOverCDP('local', { connect: make('Target closed') }), true);
  await assert.rejects(requestChromeCloseOverCDP('local', { connect: make('Permission denied') }), /Permission denied/);
});
test('download file polling awaits asynchronous readers instead of treating a Promise as a file', async () => {
  let calls = 0;
  const result = await waitForDownloadArtifactState(async () => ++calls < 2 ? null : { file: 'fixture.xlsx' }, 100, 20);
  assert.deepEqual(result, { file: 'fixture.xlsx' }); assert.equal(calls, 2);
});
test('endless replacement popups stop at a configured bound', async () => {
  let serial = 0; let clicks = 0;
  const close = { click: async () => { serial++; clicks++; } };
  const popup = {
    locator: () => ({ count: async () => 1, first: () => close }),
    elementHandle: async () => ({ evaluate: async () => ({ className: 'promo', text: String(serial), visible: true }), dispose: async () => {} })
  };
  const surface = { locator: () => ({ count: async () => 1, first: () => popup }), waitForTimeout: async () => {} };
  await assert.rejects(dismissBlockingPopups(surface, { maxPopups: 2 }), /安全次数上限/);
  assert.equal(clicks, 2);
});

test('shutdown during old-browser close cannot spawn the replacement', async () => {
  const { runManagedOpenWindowEngine } = require('../src/shared/managedOpenWindowEngine');
  const { requestApplicationShutdown, resetApplicationShutdownSignal } = require('../src/shared/applicationShutdownSignal');
  let launches = 0;
  try {
    await assert.rejects(runManagedOpenWindowEngine({
      platformKey: 'jd', browserMode: 'headed', preserveCache: true,
      storeConfig: { key: 'fixture', displayName: 'fixture', siteUrl: 'https://kf.jd.com/fixture', username: 'fixture' }
    }, {
      closeManagedChrome: async () => requestApplicationShutdown(),
      launchChromeForManualLogin: async () => launches++, logFn: () => {}
    }), /程序正在退出/);
    assert.equal(launches, 0);
  } finally { resetApplicationShutdownSignal(); }
});


test('human verification time is excluded from the popup safety deadline', async () => {
  let clock = 0;
  const page = fakePage();
  page.getByText = expression => locator(clock < 2000 && expression.test('请完成安全验证'));
  const { getAutomationTime } = require('../src/engine/browserAutomationScope');
  await runInAutomationScope(scope({ headless: false, humanTimeoutMs: 5000, now: () => clock,
    wait: async ms => { clock += ms; } }), async () => {
    registerAutomationBrowser(browserFor(page));
    const surface = { locator: () => ({ count: async () => 0 }) };
    assert.equal(await dismissBlockingPopups(surface, { totalTimeoutMs: 1000 }), 0);
    assert.equal(clock, 2000);
    assert.equal(getAutomationTime(), 0);
  });
});
test('a page closing during popup-handler installation cannot fail browser connection', async () => {
  const { EventEmitter } = require('node:events');
  const { installBrowserPopupGuard } = require('../src/engine/browserPopupGuard');
  let closed = false;
  const page = Object.assign(new EventEmitter(), {
    isClosed: () => closed, url: () => 'about:blank',
    locator: () => ({ first: () => ({}) }),
    addLocatorHandler: async () => { closed = true; throw new Error('Target page, context or browser has been closed'); }
  });
  const context = Object.assign(new EventEmitter(), { pages: () => [page] });
  const browser = Object.assign(new EventEmitter(), { contexts: () => [context] });
  await installBrowserPopupGuard(browser);
  browser.emit('disconnected');
  assert.equal(context.listenerCount('page'), 0);
  assert.equal(page.listenerCount('framenavigated'), 0);
});


test('a late popup cannot replay a possibly submitted export action', async () => {
  const { runAfterDismissingBlockingPopups } = require('../src/shared/blockingPopupEngine');
  let visible = false; let attempts = 0; let closed = 0;
  const popup = {
    locator: () => ({ count: async () => 1, first: () => ({ click: async () => { visible = false; closed++; } }) }),
    elementHandle: async () => ({ evaluate: async () => ({ className: 'promo', text: 'promo', visible }), dispose: async () => {} })
  };
  const surface = { locator: () => ({ count: async () => visible ? 1 : 0, first: () => popup }), waitForTimeout: async () => {} };
  await assert.rejects(runInAutomationScope(scope(), () => runAfterDismissingBlockingPopups(surface, async () => {
    attempts++; markExportAttempted(); visible = true; throw new Error('export result unknown');
  })), /export result unknown/);
  assert.equal(attempts, 1); assert.equal(closed, 1);
});
