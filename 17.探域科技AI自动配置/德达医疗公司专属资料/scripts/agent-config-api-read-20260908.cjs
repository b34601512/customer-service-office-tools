// 意图：读取接待、自动发送、转交话术、触发器、意图和风格配置。
// 范围：thirdShopId=2095398963959042048；只读，不写后台。
// 验证：检查业务成功码并保存JSON快照；恢复：无外部副作用。
const fs = require('fs');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const SOURCE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-api-20260907';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-config-read-20260908';
const OUT = 'D:/桌面/办公软件/17.探域科技AI自动配置/德达医疗公司专属资料/agent-config-read-20260908.json';
const calls = [
  ['agent-config-get', 'POST', '/api/shop-config/agent/config/get', { orgId: '2095398963959042048', metaIds: ['agent.reception.salesStageJudgment'] }],
  ['agent-config-list', 'POST', '/api/copilot/agent/config/list'],
  ['reception-variables', 'GET', '/api/shop-config/agent/config/variables/get'],
  ['auto-send-plans', 'GET', '/api/shop-config/agent/auto-send-bind/get/plan-detail'],
  ['before-transfer', 'GET', '/api/shop-config/v1/agent/before-manual-transfer-rule/get'],
  ['smart-trigger-list', 'GET', '/api/shop-config/v1/agent/smart-trigger-rule/list'],
  ['consult-intent-list', 'GET', '/api/shop-config/agent-consult-intent/list'],
  ['reply-intent-list', 'GET', '/api/shop-config/agent-reply-intent/list'],
  ['intent-list', 'GET', '/api/shop-config/intents/list'],
  ['custom-agent-list', 'GET', '/api/copilot/v1/agent/customized-agent/list'],
  ['customer-style-list', 'GET', '/api/shop-config/customer-style/list']
];
function keep(p) { return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p); }

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: keep });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const result = {};
    for (const [name, method, endpoint, requestBody] of calls) {
      const data = await page.evaluate(async ({ method, endpoint, requestBody }) => {
        const r = await fetch(endpoint, { method, credentials: 'include', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? JSON.stringify(requestBody || {}) : undefined });
        const j = await r.json();
        return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg };
      }, { method, endpoint, requestBody });
      if (data.code !== 1) throw new Error(`${name}: ${data.msg || data.httpStatus}`);
      result[name] = { method, endpoint, ...data };
    }
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, { endpoint: v.endpoint, httpStatus: v.httpStatus, code: v.code, success: v.success }])) , null, 2));
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
