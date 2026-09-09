const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  buildLaunchArgs,
  candidateBrowserPaths,
  launchVisibleBrowser
} = require('../src/services/browserSession');

test('独立浏览器参数不恢复现有会话', () => {
  const args = buildLaunchArgs({ port: 9333, userDataDir: 'D:\\runtime\\profile', targetUrl: 'https://example.test' });
  assert.ok(args.includes('--remote-debugging-port=9333'));
  assert.ok(args.includes('--user-data-dir=D:\\runtime\\profile'));
  assert.ok(args.includes('--no-first-run'));
  assert.ok(args.includes('--hide-crash-restore-bubble'));
  assert.ok(!args.includes('--restore-last-session'));
  assert.equal(args.at(-1), 'https://example.test');
});

test('Edge 路径优先且启动使用 detached spawn', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-qa-browser-'));
  let spawnOptions;
  let unrefCalled = false;
  const spawn = (executablePath, args, options) => {
    spawnOptions = { executablePath, args, options };
    const child = new EventEmitter();
    child.pid = 1234;
    child.unref = () => { unrefCalled = true; };
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  const result = await launchVisibleBrowser({
    browser: 'edge',
    port: 9333,
    userDataDir: profile,
    targetUrl: 'https://example.test',
    executablePath: 'msedge.exe'
  }, { isPortOpen: async () => false, spawn });
  assert.equal(result.pid, 1234);
  assert.equal(spawnOptions.options.detached, true);
  assert.equal(spawnOptions.options.windowsHide, false);
  assert.equal(unrefCalled, true);
  assert.ok(fs.existsSync(profile));
  assert.ok(candidateBrowserPaths('edge').length >= 2);
});

test('端口被占用时不启动新浏览器', async () => {
  let spawned = false;
  await assert.rejects(
    launchVisibleBrowser({ port: 9333, userDataDir: 'D:\\runtime\\profile', targetUrl: 'https://example.test' }, {
      isPortOpen: async () => true,
      spawn: () => { spawned = true; }
    }),
    /调试端口 9333 已被占用/
  );
  assert.equal(spawned, false);
});
