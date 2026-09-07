const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const sourceProfile = 'C:/Users/b3460/.pi-edge-auto';
const probeProfile = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-probe-20260907';
const output = 'D:/桌面/办公软件/17.探域科技AI自动配置/德达医疗公司专属资料/custom-agent-read-probe-20260907.json';

function keep(p) {
  return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p);
}

(async () => {
  fs.rmSync(probeProfile, { recursive: true, force: true });
  fs.cpSync(sourceProfile, probeProfile, { recursive: true, filter: keep });
  const ctx = await chromium.launchPersistentContext(probeProfile, {
    channel: 'msedge',
    headless: true,
    args: ['--disable-gpu']
  });
  const logs = [];
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('response', async response => {
      const url = response.url();
      if (!url.includes('/api/')) return;
      const method = response.request().method();
      let body = null;
      try { body = await response.json(); } catch {}
      logs.push({
        url,
        method,
        status: response.status(),
        requestBody: response.request().postData() || null,
        response: body
      });
    });
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/custom-agent', {
      waitUntil: 'networkidle', timeout: 45000
    });
    await page.waitForTimeout(5000);
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(x => x.name).filter(x => /\.js(?:\?|$)/.test(x)));
    console.log(JSON.stringify({ title: await page.title(), url: page.url(), text: (await page.locator('body').innerText()).slice(0, 2000) }, null, 2));
    console.log('LINKS', await page.evaluate(() => Array.from(document.querySelectorAll('a')).map(a => ({ text: (a.innerText || '').trim(), href: a.href })).filter(x => x.text || x.href)));
    console.log('RESOURCES', resources);
    const bundleHits = [];
    for (const resource of [...new Set(resources)]) {
      try {
        const source = await page.evaluate(async url => await (await fetch(url, { credentials: 'include' })).text(), resource);
        const hits = [...source.matchAll(/\/api\/[A-Za-z0-9_?=&.\/-]+/g)].map(x => x[0]);
        if (hits.some(x => /agent|config|prompt|custom|strategy|协作/i.test(x))) bundleHits.push({ resource, hits: [...new Set(hits)].slice(0, 200) });
      } catch {}
    }
    fs.writeFileSync(output.replace('.json', '-bundles.json'), JSON.stringify(bundleHits, null, 2), 'utf8');
    console.log('BUNDLE_HITS', JSON.stringify(bundleHits));
    fs.writeFileSync(output, JSON.stringify(logs, null, 2), 'utf8');
    console.log('API_LOGS', logs.map(x => ({ url: x.url, method: x.method, status: x.status })));
  } finally {
    await ctx.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
