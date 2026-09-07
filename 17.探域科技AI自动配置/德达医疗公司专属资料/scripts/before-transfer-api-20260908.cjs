// 意图：读取转交前话术；按授权执行同文回读测试。
// 范围：目标店铺转交前话术；默认只读，写入须显式test-save-same。
// 验证：完整结构SHA-256；恢复：写入前后备份。
const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const SOURCE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-api-20260907';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-before-transfer-20260908';
const BACKUP = 'D:/备份文件夹/探域问答审核-20260907-before-transfer';
const action = process.argv.includes('--action') ? process.argv[process.argv.indexOf('--action') + 1] : 'read';
function keep(p) { return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p); }
function sha(v) { return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'); }

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: keep });
  fs.mkdirSync(BACKUP, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const read = await page.evaluate(async () => {
      const r = await fetch('/api/shop-config/v1/agent/before-manual-transfer-rule/get', { credentials: 'include' });
      const j = await r.json();
      return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg };
    });
    if (read.code !== 1) throw new Error(read.msg || '读取转交前话术失败');
    fs.writeFileSync(`${BACKUP}/before-${Date.now()}.json`, JSON.stringify(read, null, 2));
    const payload = JSON.parse(JSON.stringify(read.data));
    console.log(JSON.stringify({ action, endpoint: '/api/shop-config/v1/agent/before-manual-transfer-rule/save', payloadSha256: sha(payload), speechCount: payload.beforeTransferSpeeches?.length ?? 0 }, null, 2));
    if (action !== 'test-save-same') return;
    const write = await page.evaluate(async (payload) => {
      const r = await fetch('/api/shop-config/v1/agent/before-manual-transfer-rule/save', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg };
    }, payload);
    fs.writeFileSync(`${BACKUP}/write-${Date.now()}.json`, JSON.stringify(write, null, 2));
    if (write.code !== 1) throw new Error(write.msg || '转交前话术写入失败');
    const after = await page.evaluate(async () => {
      const r = await fetch('/api/shop-config/v1/agent/before-manual-transfer-rule/get', { credentials: 'include' });
      const j = await r.json();
      return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg };
    });
    fs.writeFileSync(`${BACKUP}/after-${Date.now()}.json`, JSON.stringify(after, null, 2));
    const verified = after.code === 1 && sha(after.data) === sha(payload);
    console.log(JSON.stringify({ action, verified, afterSha256: sha(after.data) }, null, 2));
    if (!verified) process.exitCode = 2;
  } finally { await ctx.close(); }
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });
