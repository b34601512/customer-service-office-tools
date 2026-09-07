// 意图：通过模拟API发送指定测试问题并轮询回复。
// 范围：目标店铺隔离测试会话；验证：发送、轮询、重置；恢复：结束重置测试会话。
const fs = require('fs');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const SOURCE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-api-20260907';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-simulation-test-20260908';
const OUT = 'D:/桌面/办公软件/17.探域科技AI自动配置/德达医疗公司专属资料/simulation-api-test-20260908.json';
const SHOP = '2095398963959042048';
const QUESTIONS = ['我血氧93%，想买制氧机，推荐几升？', '不吸氧血氧93%，平时应该买哪种制氧机？'];
function keep(p) { return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p); }
async function api(page, url, options) { return page.evaluate(async ({ url, options }) => { const r = await fetch(url, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } }); const j = await r.json(); return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg }; }, { url, options }); }
(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true }); fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: keep });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage(); await page.goto('http://agent.tanyuai.com/v2/agent-builder', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const bots = await api(page, '/api/im/agent-flow-versions/stable/list'); if (bots.code !== 1 || !bots.data?.length) throw new Error(bots.msg || '没有可用模拟Agent');
    const botId = bots.data.find(x => x.ifDefault)?.botId || bots.data[0].botId;
    const sends = [];
    for (const question of QUESTIONS) {
      const send = await api(page, '/api/im/agent/debug/send-buyer-message', { method: 'POST', body: JSON.stringify({ botId, orderStatus: 0, thirdShopId: SHOP, sourceType: 0, customizedAgentModel: 'formal', msgContent: { type: 0, value: question } }) });
      if (send.code !== 1) throw new Error(send.msg || '模拟提问失败');
      sends.push({ question, send });
      await new Promise(resolve => setTimeout(resolve, 8000));
    }
    const content = await api(page, `/api/im/agent/debug/get-content?thirdShopId=${SHOP}`); if (content.code !== 1) throw new Error(content.msg || '读取模拟回复失败');
    const result = { questions: QUESTIONS, botId, sends, content, testedAt: new Date().toISOString() };
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify({ questions: QUESTIONS, sendSuccess: sends.every(x => x.send.success), contextCount: content.data?.contextBodyList?.length ?? 0, output: OUT }, null, 2));
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
