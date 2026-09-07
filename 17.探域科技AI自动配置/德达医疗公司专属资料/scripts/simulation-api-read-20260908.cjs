// 意图：读取模拟上下文和卡片；范围：目标店铺；只读。
// 验证：保存接口响应快照；恢复：无外部副作用。
const fs = require('fs');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const SOURCE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-api-20260907';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-simulation-read-20260908';
const OUT = 'D:/桌面/办公软件/17.探域科技AI自动配置/德达医疗公司专属资料/simulation-api-read-20260908.json';
const SHOP = '2095398963959042048';
function keep(p) { return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p); }
(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: keep });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const result = {};
    for (const [name, endpoint] of [['content', `/api/im/agent/debug/get-content?thirdShopId=${SHOP}`], ['cards', `/api/im/agent/debug/get-card-list?thirdShopId=${SHOP}`]]) {
      const value = await page.evaluate(async (url) => { const r = await fetch(url, { credentials: 'include' }); const j = await r.json(); return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg }; }, endpoint);
      if (value.code !== 1) throw new Error(`${name}: ${value.msg || value.httpStatus}`);
      result[name] = value;
    }
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify({ contentCount: result.content.data?.contextBodyList?.length ?? 0, cardCount: Array.isArray(result.cards.data) ? result.cards.data.length : 0, readOnly: true, output: OUT }, null, 2));
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
