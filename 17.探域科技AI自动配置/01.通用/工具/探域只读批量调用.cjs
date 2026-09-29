// 意图：用独立无头登录态对探域后台做**只读**批量查询（对账、回读核对、接口探测）。
// 范围：调用者传入接口列表；默认只允许 GET，POST 必须显式 --allow-post true（用于平台的 *paginate 查询类接口）。
// 验证：逐条打印 HTTP 状态与业务码；不写后台、不改配置；恢复：无外部副作用。
//
// 用法：
//   node 探域只读批量调用.cjs --base-url http://agent.tanyuai.com --profile "登录画像路径" \
//     --calls "查询清单.json" [--allow-post true] [--out "结果.json"]
//
// 查询清单格式：[{ "name": "别名", "endpoint": "/api/xxx", "method": "GET", "body": {...} }, ...]
const fs = require('fs');
const playwrightCorePath = process.env.PLAYWRIGHT_CORE_PATH || argument('--playwright-core-path');
const { chromium } = require(playwrightCorePath || 'playwright-core');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

(async () => {
  const baseUrl = required('--base-url').replace(/\/$/, '');
  const profile = required('--profile');
  const callsFile = required('--calls');
  const allowPost = (argument('--allow-post', 'false') || '').toLowerCase() === 'true';
  const calls = JSON.parse(fs.readFileSync(callsFile, 'utf8'));
  if (!Array.isArray(calls) || !calls.length) throw new Error('--calls 必须是非空数组');

  const launchOptions = { headless: true };
  const browserChannel = argument('--browser-channel');
  if (browserChannel) launchOptions.channel = browserChannel;

  const context = await chromium.launchPersistentContext(profile, launchOptions);
  const results = [];
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // 等 SPA 自己跳转/加载完，否则 eval 期间上下文被导航销毁
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    for (const call of calls) {
      const method = (call.method || 'GET').toUpperCase();
      if (method !== 'GET' && !allowPost) throw new Error(`非 GET 接口 ${call.endpoint} 需显式 --allow-post true`);
      if (!String(call.endpoint).startsWith('/')) throw new Error('endpoint 必须以/开头');
      const body = call.body ? JSON.stringify(call.body) : undefined;
      const result = await page.evaluate(async ({ endpoint, method, body }) => {
        const response = await fetch(endpoint, {
          method,
          credentials: 'include',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body
        });
        let json = null;
        try { json = await response.json(); } catch { /* 非 JSON 响应 */ }
        return { httpStatus: response.status, json };
      }, { endpoint: call.endpoint, method, body });
      const json = result.json || {};
      results.push({
        name: call.name || call.endpoint,
        endpoint: call.endpoint,
        method,
        httpStatus: result.httpStatus,
        businessCode: json.code,
        message: json.msg,
        data: json.data
      });
      const jsonStr = JSON.stringify(json.data) ?? 'undefined';
      console.log(`${(call.name || call.endpoint).padEnd(22)} http=${result.httpStatus} code=${json.code} ${json.msg || ''} ${jsonStr.length > 700 ? jsonStr.slice(0, 700) + `…(共 ${jsonStr.length} 字符)` : jsonStr}`);
    }
  } finally {
    await context.close();
  }
  const out = argument('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
  if (results.some(r => r.httpStatus < 200 || r.httpStatus >= 300 || (r.businessCode !== undefined && r.businessCode !== 1))) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
