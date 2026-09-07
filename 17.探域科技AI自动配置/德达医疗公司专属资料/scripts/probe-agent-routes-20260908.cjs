const fs = require('fs');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const SOURCE = 'C:/Users/b3460/.pi-edge-auto';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-route-probe-20260908';
const OUT = 'D:/桌面/办公软件/17.探域科技AI自动配置/德达医疗公司专属资料/agent-route-api-probe-20260908.json';
const routes = [
  'custom-agent', 'custom-style', 'assisted-reception', 'conversation-cycle',
  'focus-order', 'focus-product', 'pre-sales-after-sales-status',
  'manual-transfer-speech', 'buyer-salutation', 'light-reading-seconds',
  'prevent-interruption', 'automatic-sending-scenarios', 'reply-identifier',
  'toolkit', 'consultation-intent-library', 'trigger', 'speech-interception',
  'fallback-speech'
];

function keep(p) { return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p); }

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: keep });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  const logs = [];
  const resources = new Set();
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('response', async response => {
      const url = response.url();
      if (!url.includes('/api/')) return;
      let body = null;
      try { body = await response.json(); } catch {}
      logs.push({ route: page.url(), url, method: response.request().method(), status: response.status(), requestBody: response.request().postData() || null, response: body });
    });
    for (const route of routes) {
      await page.goto(`http://agent.tanyuai.com/v2/agent-builder/${route}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(1800);
      for (const u of await page.evaluate(() => performance.getEntriesByType('resource').map(x => x.name).filter(x => /\.js(?:\?|$)/.test(x)))) resources.add(u);
    }
  } finally { await ctx.close(); }
  fs.writeFileSync(OUT, JSON.stringify({ resources: [...resources], logs }, null, 2), 'utf8');
  const summary = [...new Map(logs.map(x => [x.method + ' ' + x.url.split('?')[0], x])).values()].map(x => ({ method: x.method, url: x.url.split('?')[0], status: x.status, requestBody: x.requestBody }));
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
