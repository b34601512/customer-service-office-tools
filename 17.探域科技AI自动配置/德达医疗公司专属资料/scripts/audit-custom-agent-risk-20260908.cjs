// 意图：审计Agent是否存在疾病/血氧到设备参数的危险映射。
// 范围：指定Agent正式与草稿正文；只读；验证：SHA、长度、风险命中项。
const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const SOURCE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-agent-api-20260907';
const PROFILE = 'C:/Users/b3460/AppData/Local/Temp/codex-tanyu-risk-audit-20260908';
const OUT = 'D:/桌面/办公软件/17.探域科技AI自动配置/德达医疗公司专属资料/custom-agent-risk-audit-20260908.json';
const ID = process.argv.includes('--id') ? process.argv[process.argv.indexOf('--id') + 1] : '6a9e263e34c0ab0f8e1c0999';
const patterns = [
  ['血氧数值直接映射', /血氧|SpO2|饱和度/i],
  ['医院档位映射家用流量', /医院.{0,12}(档位|级|升)|(?:1|2|3|5|10)\s*L.{0,12}(家用|机器|流量)/i],
  ['疾病直接决定流量', /COPD|慢阻肺|肺气肿|疾病.{0,12}(流量|升数|浓度)/i],
  ['自行确定氧疗参数', /(自行|直接|按).{0,12}(流量|浓度|时长|参数)/i]
];
function keep(p) { return !/(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Crashpad|BrowserMetrics|Safe Browsing)([\\/]|$)/i.test(p); }
function sha(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true }); fs.cpSync(SOURCE, PROFILE, { recursive: true, filter: keep });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/custom-agent', { waitUntil: 'domcontentloaded', timeout: 45000 });
    const detail = await page.evaluate(async (id) => { const r = await fetch(`/api/copilot/v1/agent/customized-agent/detail?id=${id}`, { credentials: 'include' }); const j = await r.json(); return { httpStatus: r.status, code: j.code, success: j.success, data: j.data, msg: j.msg }; }, ID);
    if (detail.code !== 1) throw new Error(detail.msg || '读取Agent详情失败');
    const inspect = (content) => { const text = String(content || ''); return { sha256: sha(text), length: text.length, findings: patterns.filter(([, re]) => re.test(text)).map(([name]) => name) }; };
    const result = { id: ID, agentName: detail.data?.name, online: inspect(detail.data?.onlineContent?.content), draft: inspect(detail.data?.draftContent?.content), riskRule: '发现即人工复核；不得自动发布或自动改写' };
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8'); console.log(JSON.stringify(result, null, 2));
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
