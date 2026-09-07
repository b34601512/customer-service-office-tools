// 意图：在隔离模拟会话中发送参数化问题，并只读取本轮新增回复。
// 范围：调用者提供平台地址、登录画像、问题文件和可选重置/新增回复判定参数。
// 读写级别：测试；验证：每条问题和回复标记均为新增；恢复：测试前后可调用重置接口。
const fs = require('fs');
const playwrightCoreIndex = process.argv.indexOf('--playwright-core-path');
const playwrightCorePath = process.env.PLAYWRIGHT_CORE_PATH || (playwrightCoreIndex >= 0 ? process.argv[playwrightCoreIndex + 1] : null);
const { chromium } = require(playwrightCorePath || 'playwright-core');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const required = name => { const value = arg(name); if (!value) throw new Error(`缺少参数 --${name}`); return value; };
const repeated = name => {
  const values = [];
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === `--${name}` && process.argv[i + 1]) values.push(process.argv[++i]);
  return values;
};

(async () => {
  const baseUrl = required('base-url').replace(/\/$/, '');
  const profile = required('profile');
  const pagePath = required('page-path');
  const questionsFile = required('questions-file');
  const questions = JSON.parse(fs.readFileSync(questionsFile, 'utf8'));
  if (!Array.isArray(questions) || !questions.length || questions.some(q => typeof q !== 'string' || !q.trim())) throw new Error('问题文件必须是非空字符串数组');
  const inputPlaceholder = required('input-placeholder');
  const replyMarker = arg('reply-marker');
  const resetEndpoint = arg('reset-endpoint');
  const timeout = Number(arg('timeout-ms') || 45000);
  const launchOptions = { headless: true };
  const browserChannel = arg('browser-channel');
  if (browserChannel) launchOptions.channel = browserChannel;
  const ctx = await chromium.launchPersistentContext(profile, launchOptions);
  let page;
  try {
    page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(baseUrl + pagePath, { waitUntil: 'domcontentloaded', timeout });
    const reset = async () => {
      if (!resetEndpoint) return;
      const result = await page.evaluate(async endpoint => {
        const response = await fetch(endpoint, { method: 'POST', credentials: 'include' });
        return response.json();
      }, resetEndpoint);
      if (result.code !== 1) throw new Error(result.msg || '模拟会话重置失败');
    };
    await reset();
    const box = page.getByPlaceholder(inputPlaceholder, { exact: true });
    const output = [];
    for (const question of questions) {
      const before = await page.locator('body').innerText();
      const beforeQuestionCount = before.split(question).length - 1;
      const beforeMarkerCount = replyMarker ? before.split(replyMarker).length - 1 : 0;
      await box.fill(question);
      await box.press('Enter');
      let status = 'replied';
      try {
        await page.waitForFunction(({ question, beforeQuestionCount, replyMarker, beforeMarkerCount }) => {
          const text = document.body?.innerText || '';
          const questionAdded = text.split(question).length - 1 > beforeQuestionCount;
          const markerAdded = !replyMarker || text.split(replyMarker).length - 1 > beforeMarkerCount;
          return questionAdded && markerAdded;
        }, { question, beforeQuestionCount, replyMarker, beforeMarkerCount }, { timeout });
      } catch { status = 'timeout'; }
      const text = await page.locator('body').innerText();
      const index = text.lastIndexOf(question);
      output.push({ question, status, beforeQuestionCount, afterQuestionCount: text.split(question).length - 1, beforeMarkerCount, afterMarkerCount: replyMarker ? text.split(replyMarker).length - 1 : null, tail: text.slice(index, Math.min(text.length, index + 1400)) });
    }
    console.log(JSON.stringify(output, null, 2));
    if (output.some(item => item.status !== 'replied')) throw new Error('至少一条测试问题未获得新增回复');
  } finally {
    if (page && resetEndpoint) { try { await page.evaluate(async endpoint => { await fetch(endpoint, { method: 'POST', credentials: 'include' }); }, resetEndpoint); } catch (error) { console.error('测试后重置失败：' + error.message); } }
    await ctx.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
