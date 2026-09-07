// 意图：读取自动发送方案；按授权执行同文可恢复回读测试。
// 范围：目标店铺自动发送方案；默认只读，写入须显式test-save-same。
// 验证：业务字段归一化比较；恢复：写入前后备份，已完成一次测试不重复。
const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const SOURCE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-api-20260907';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-auto-send-20260908';
const BACKUP = 'D:/备份文件夹/探域问答审核-20260907-auto-send';
const action = process.argv.includes('--action') ? process.argv[process.argv.indexOf('--action') + 1] : 'read';
function keep(p) { return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p); }
function sha(v) { return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
function comparablePlans(v) { return JSON.parse(JSON.stringify(v, (key, value) => key === 'planId' ? undefined : value)); }

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: keep });
  fs.mkdirSync(BACKUP, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const read = await page.evaluate(async () => {
      const r = await fetch('/api/shop-config/agent/auto-send-bind/get/plan-detail', { credentials: 'include' });
      const j = await r.json();
      return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg };
    });
    if (read.code !== 1) throw new Error(read.msg || '读取自动发送方案失败');
    fs.writeFileSync(`${BACKUP}/before-${Date.now()}.json`, JSON.stringify(read, null, 2));
    const plans = read.data.map((plan) => {
      const copy = JSON.parse(JSON.stringify(plan));
      if (copy.accountType === 1) { copy.services = []; copy.serviceGroups = []; }
      if (copy.accountType === 2) copy.bindAccounts = [];
      return copy;
    });
    const payload = { plans };
    console.log(JSON.stringify({ action, endpoint: '/api/shop-config/agent/auto-send-bind/batch-save', planCount: plans.length, payloadSha256: sha(payload), readSha256: sha(read.data) }, null, 2));
    if (action !== 'test-save-same') return;
    const write = await page.evaluate(async (payload) => {
      const r = await fetch('/api/shop-config/agent/auto-send-bind/batch-save', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg };
    }, payload);
    fs.writeFileSync(`${BACKUP}/write-${Date.now()}.json`, JSON.stringify(write, null, 2));
    if (write.code !== 1) throw new Error(write.msg || '自动发送方案写入失败');
    const after = await page.evaluate(async () => {
      const r = await fetch('/api/shop-config/agent/auto-send-bind/get/plan-detail', { credentials: 'include' });
      const j = await r.json();
      return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg };
    });
    fs.writeFileSync(`${BACKUP}/after-${Date.now()}.json`, JSON.stringify(after, null, 2));
    const verified = after.code === 1 && sha(comparablePlans(after.data)) === sha(comparablePlans(plans));
    console.log(JSON.stringify({ action, verified, afterSha256: sha(after.data), comparableSha256: sha(comparablePlans(after.data)), planIdsRecreated: after.data.map((p) => p.planId) }, null, 2));
    if (!verified) process.exitCode = 2;
  } finally { await ctx.close(); }
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });
