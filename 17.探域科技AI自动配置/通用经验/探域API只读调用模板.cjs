// 意图：用独立无头登录态调用已核实的探域API，作为跨公司只读模板。
// 范围：调用者明确传入的接口；默认只读，不提供保存/发布动作。
// 验证：检查HTTP状态和业务JSON；恢复：无外部副作用。
const fs = require('fs');
const { chromium } = require('playwright-core');

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
  const endpoint = required('--endpoint');
  const method = (argument('--method', 'GET') || 'GET').toUpperCase();
  const bodyFile = argument('--body-file');
  if (!endpoint.startsWith('/')) throw new Error('--endpoint必须以/开头');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('不支持的HTTP方法');
  if (method === 'GET' && bodyFile) throw new Error('GET不得传请求体');
  const body = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : undefined;
  const context = await chromium.launchPersistentContext(profile, { headless: true });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const result = await page.evaluate(async ({ endpoint, method, body }) => {
      const response = await fetch(endpoint, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body
      });
      const json = await response.json();
      return { httpStatus: response.status, businessCode: json.code, success: json.success, message: json.msg, data: json.data };
    }, { endpoint, method, body });
    console.log(JSON.stringify(result, null, 2));
    if (result.httpStatus < 200 || result.httpStatus >= 300 || (result.businessCode !== undefined && result.businessCode !== 1)) process.exitCode = 1;
  } finally { await context.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
