// 意图：读取并验证接待订单判定配置的API读写路线。
// 范围：thirdShopId=2095398963959042048；默认只读，显式test-save-same才写入。
// 验证：写入前后完整JSON比较；恢复：同文写入，不改变业务值，快照保存在备份目录。
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const SOURCE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-api-20260907';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-reception-api-20260908';
const SHOP = '2095398963959042048';
const META = 'agent.reception.salesStageJudgment';
const BACKUP = 'D:/备份文件夹/探域问答审核-20260908-reception';
function keep(p) { return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p); }
async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(BACKUP, { recursive: true });
  fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: keep });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const api = (endpoint, method, body) => page.evaluate(async ({ endpoint, method, body }) => {
      const r = await fetch(endpoint, { method, credentials: 'include', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (!r.ok || j.code !== 1) throw new Error(`${endpoint}: ${j.msg || r.status}`);
      return j.data;
    }, { endpoint, method, body });
    const read = () => api('/api/shop-config/agent/config/get', 'POST', { orgId: SHOP, metaIds: [META] });
    const before = await read();
    fs.writeFileSync(path.join(BACKUP, `before-${Date.now()}.json`), JSON.stringify(before, null, 2));
    const action = process.argv[2] || 'read';
    if (action === 'read') { console.log(JSON.stringify({ action, config: before }, null, 2)); return; }
    if (action !== 'test-save-same') throw new Error(`未知动作: ${action}`);
    const config = before?.configs?.[META] || before?.[META] || { consultOrderStrategy: 1, preSalesJudgeRange: 15 };
    const payload = { orgId: SHOP, configs: { [META]: config } };
    fs.writeFileSync(path.join(BACKUP, `payload-${Date.now()}.json`), JSON.stringify(payload, null, 2));
    await api('/api/shop-config/agent/config/save', 'POST', payload);
    const after = await read();
    fs.writeFileSync(path.join(BACKUP, `after-${Date.now()}.json`), JSON.stringify(after, null, 2));
    const beforeText = JSON.stringify(before?.configs?.[META] || before?.[META] || config);
    const afterText = JSON.stringify(after?.configs?.[META] || after?.[META] || after);
    console.log(JSON.stringify({ action, verified: beforeText === afterText, before: beforeText, after: afterText }, null, 2));
    if (beforeText !== afterText) throw new Error('接待配置写入后回读不一致');
  } finally { await ctx.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
