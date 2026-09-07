// 意图：跨公司对探域JSON配置执行读取或可恢复同文保存回读。
// 范围：调用者传入的接口、请求体和备份目录；默认只读，不写死业务字段。
// 验证：前后响应数据归一化比较；恢复：只建议同文测试，快照完整保存。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const playwrightCoreIndex = process.argv.indexOf('--playwright-core-path');
const playwrightCorePath = process.env.PLAYWRIGHT_CORE_PATH || (playwrightCoreIndex >= 0 ? process.argv[playwrightCoreIndex + 1] : null);
const { chromium } = require(playwrightCorePath || 'playwright-core');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const required = name => { const value = arg(name); if (!value) throw new Error(`缺少参数 --${name}`); return value; };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); };
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
function normalize(value, ignoredKeys) {
  if (Array.isArray(value)) return value.map(item => normalize(item, ignoredKeys));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ignoredKeys.has(key)).map(([key, item]) => [key, normalize(item, ignoredKeys)]));
}

(async () => {
  const baseUrl = required('base-url').replace(/\/$/, '');
  const profile = required('profile');
  const readEndpoint = required('read-endpoint');
  const readMethod = (arg('read-method') || 'GET').toUpperCase();
  const readBody = arg('read-body-file') ? fs.readFileSync(arg('read-body-file'), 'utf8') : undefined;
  const action = arg('action') || 'read';
  const backupDir = required('backup-dir');
  const ignoredKeys = new Set();
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--ignore-key' && process.argv[i + 1]) ignoredKeys.add(process.argv[++i]);
  }
  const launchOptions = { headless: true };
  const browserChannel = arg('browser-channel');
  if (browserChannel) launchOptions.channel = browserChannel;
  const context = await chromium.launchPersistentContext(profile, launchOptions);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const call = (endpoint, method, body) => page.evaluate(async ({ endpoint, method, body }) => {
      const response = await fetch(endpoint, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : undefined, body });
      const json = await response.json();
      if (!response.ok || json.code !== 1) throw new Error(json.msg || `HTTP ${response.status}`);
      return json;
    }, { endpoint, method, body });
    const before = await call(readEndpoint, readMethod, readBody);
    writeJson(path.join(backupDir, `before-${Date.now()}.json`), before);
    if (action === 'read') { console.log(JSON.stringify({ action, sha256: sha(before.data), data: before.data }, null, 2)); return; }
    if (action !== 'test-save-same') throw new Error(`未知动作 ${action}`);
    const saveEndpoint = required('save-endpoint');
    const payloadFile = required('payload-file');
    const payload = fs.readFileSync(payloadFile, 'utf8');
    writeJson(path.join(backupDir, `payload-${Date.now()}.json`), readJson(payloadFile));
    const saved = await call(saveEndpoint, 'POST', payload);
    writeJson(path.join(backupDir, `save-response-${Date.now()}.json`), saved);
    const after = await call(readEndpoint, readMethod, readBody);
    writeJson(path.join(backupDir, `after-${Date.now()}.json`), after);
    const same = JSON.stringify(normalize(before.data, ignoredKeys)) === JSON.stringify(normalize(after.data, ignoredKeys));
    console.log(JSON.stringify({ action, verified: same, beforeSha256: sha(before.data), afterSha256: sha(after.data), ignoredKeys: [...ignoredKeys] }, null, 2));
    if (!same) throw new Error('配置同文保存后回读不一致');
  } finally { await context.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
