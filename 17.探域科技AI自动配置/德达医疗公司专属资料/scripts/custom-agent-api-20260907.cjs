// 意图：读取/保存/发布自定义Agent并回读校验。
// 范围：德达医疗旗舰店自定义Agent；默认只读，写入需显式动作。
// 验证：详情正文SHA-256；恢复：保存前备份，发布需明确授权。
const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const SOURCE = 'C:/Users/b3460/.pi-edge-auto';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-api-20260907';
const SHOP = '2095398963959042048';
const BACKUP = 'D:/备份文件夹/探域问答审核-20260907-custom-agent';
const base = 'http://agent.tanyuai.com';

function copyProfile() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: p => !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p) });
}
function sha(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function arg(name) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; }

(async () => {
  const action = arg('action') || 'list';
  copyProfile();
  fs.mkdirSync(BACKUP, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(base + '/v2/agent-builder/custom-agent', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const call = async (path, options = {}) => page.evaluate(async ({ path, options }) => {
      const r = await fetch(path, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
      const j = await r.json();
      if (!r.ok || j.code !== 1) throw new Error(j.msg || `HTTP ${r.status}`);
      return j;
    }, { path, options });
    const list = (await call('/api/copilot/v1/agent/customized-agent/list')).data;
    fs.writeFileSync(`${BACKUP}/agent-list.json`, JSON.stringify(list, null, 2), 'utf8');
    if (action === 'list') { console.log(JSON.stringify(list, null, 2)); return; }
    const id = arg('id');
    if (!id) throw new Error('--id is required');
    const detail = (await call('/api/copilot/v1/agent/customized-agent/detail?id=' + encodeURIComponent(id))).data;
    fs.writeFileSync(`${BACKUP}/agent-${id}-before.json`, JSON.stringify(detail, null, 2), 'utf8');
    if (action === 'detail') { console.log(JSON.stringify(detail, null, 2)); return; }
    const current = detail.draftContent?.content || '';
    const contentFile = arg('content-file');
    const sameContent = action === 'test-save-same';
    const content = sameContent ? current : (contentFile ? fs.readFileSync(contentFile, 'utf8') : null);
    const desc = arg('desc') || detail.draftContent?.desc || detail.name;
    if (!content) throw new Error('--content-file is required for save-draft/publish (test-save-same uses current draft)');
    const expected = arg('expected-sha256');
    if (expected && sha(current) !== expected) throw new Error(`before SHA mismatch: current=${sha(current)}`);
    const payload = { id, content, desc, labelGroupId: null, labelMeta: [], tableIds: [], toolType: [] };
    const endpoint = (action === 'save-draft' || sameContent) ? '/api/copilot/v1/agent/customized-agent/save-content' : '/api/copilot/v1/agent/customized-agent/publish';
    const result = await call(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    fs.writeFileSync(`${BACKUP}/agent-${id}-${action}-response.json`, JSON.stringify(result, null, 2), 'utf8');
    const after = (await call('/api/copilot/v1/agent/customized-agent/detail?id=' + encodeURIComponent(id))).data;
    fs.writeFileSync(`${BACKUP}/agent-${id}-after.json`, JSON.stringify(after, null, 2), 'utf8');
    const field = (action === 'save-draft' || sameContent) ? after.draftContent?.content : after.onlineContent?.content;
    if (field !== content) throw new Error(`${action} response did not round-trip exactly`);
    console.log(JSON.stringify({ action, id, sha256: sha(content), publishTime: after.publishTime || null, verified: true }, null, 2));
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
