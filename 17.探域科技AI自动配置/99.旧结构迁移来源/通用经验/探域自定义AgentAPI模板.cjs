// 意图：跨公司读取、保存草稿并按显式授权发布探域自定义Agent。
// 范围：调用者传入的店铺和Agent；默认只读，不写死账号、店铺、正文或本机路径。
// 验证：保存/发布后详情正文精确回读；恢复：写入前备份，发布必须显式开关。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const playwrightCoreIndex = process.argv.indexOf('--playwright-core-path');
const playwrightCorePath = process.env.PLAYWRIGHT_CORE_PATH || (playwrightCoreIndex >= 0 ? process.argv[playwrightCoreIndex + 1] : null);
const { chromium } = require(playwrightCorePath || 'playwright-core');

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
function required(name) { const value = arg(name); if (!value) throw new Error(`缺少参数 --${name}`); return value; }
function sha(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); }

(async () => {
  const baseUrl = required('base-url').replace(/\/$/, '');
  const profile = required('profile');
  const backupDir = required('backup-dir');
  const action = arg('action', 'list');
  const launchOptions = { headless: true };
  const browserChannel = arg('browser-channel');
  if (browserChannel) launchOptions.channel = browserChannel;
  const context = await chromium.launchPersistentContext(profile, launchOptions);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${baseUrl}/v2/agent-builder/custom-agent`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const call = (endpoint, options = {}) => page.evaluate(async ({ endpoint, options }) => {
      const response = await fetch(endpoint, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
      const json = await response.json();
      if (!response.ok || json.code !== 1) throw new Error(json.msg || `HTTP ${response.status}`);
      return json;
    }, { endpoint, options });
    const list = (await call('/api/copilot/v1/agent/customized-agent/list')).data;
    save(path.join(backupDir, 'agent-list.json'), list);
    if (action === 'list') { console.log(JSON.stringify(list, null, 2)); return; }
    const id = required('id');
    const detail = (await call(`/api/copilot/v1/agent/customized-agent/detail?id=${encodeURIComponent(id)}`)).data;
    save(path.join(backupDir, `agent-${id}-before.json`), detail);
    if (action === 'detail') { console.log(JSON.stringify(detail, null, 2)); return; }
    const current = detail.draftContent?.content || '';
    const content = action === 'test-save-same' ? current : fs.readFileSync(required('content-file'), 'utf8');
    const expected = arg('expected-sha256');
    if (expected && sha(current) !== expected) throw new Error(`before SHA不匹配：current=${sha(current)}`);
    if (action === 'publish' && arg('allow-publish') !== 'true') throw new Error('发布必须显式传入 --allow-publish true');
    if (!['test-save-same', 'save-draft', 'publish'].includes(action)) throw new Error(`未知动作 ${action}`);
    const payload = { id, content, desc: arg('desc', detail.draftContent?.desc || detail.name), labelGroupId: null, labelMeta: [], tableIds: [], toolType: [] };
    const endpoint = action === 'publish' ? '/api/copilot/v1/agent/customized-agent/publish' : '/api/copilot/v1/agent/customized-agent/save-content';
    save(path.join(backupDir, `agent-${id}-payload.json`), payload);
    save(path.join(backupDir, `agent-${id}-response.json`), await call(endpoint, { method: 'POST', body: JSON.stringify(payload) }));
    const after = (await call(`/api/copilot/v1/agent/customized-agent/detail?id=${encodeURIComponent(id)}`)).data;
    save(path.join(backupDir, `agent-${id}-after.json`), after);
    const actual = (action === 'publish' ? after.onlineContent?.content : after.draftContent?.content) || '';
    if (actual !== content) throw new Error('正文回读不一致');
    console.log(JSON.stringify({ action, id, sha256: sha(content), verified: true }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
