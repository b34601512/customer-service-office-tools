// 通用工具：按任务JSON安全更新探域知识卡。
// 默认只检查，不写入；写入必须 --action apply --allow-write true。
// 不写死公司、店铺、型号、正文、对象ID、账号或本机路径。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function required(name) {
  const v = arg(name);
  if (!v) throw new Error(`缺少参数 --${name}`);
  return v;
}
function stable(v) {
  return JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
}
function sha(v) {
  return crypto.createHash('sha256').update(typeof v === 'string' ? v : stable(v), 'utf8').digest('hex');
}
function segments(v) {
  if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? x : String(x?.content ?? ''));
  if (v == null) return [];
  return [String(v)];
}
function contentOf(card) {
  return (card.content || []).map(x => String(x?.content ?? ''));
}
function sameContent(a, b) { return stable(segments(a)) === stable(segments(b)); }
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

const FIELDS = [
  'id', 'title', 'content', 'labels', 'ifBelievable', 'type', 'ifOpen',
  'includeCondition', 'excludeCondition', 'timeliness', 'cycleTimeliness', 'orderStatus'
];
function payloadFrom(card, after) {
  const out = {};
  for (const key of FIELDS) out[key] = card[key];
  out.content = segments(after).map(content => ({ content }));
  return out;
}
function businessMeta(card) {
  const out = {};
  for (const key of FIELDS) if (key !== 'content') out[key] = card[key];
  return out;
}
function checkExpected(card, expected = {}) {
  const diffs = [];
  for (const [key, value] of Object.entries(expected)) {
    if (stable(card[key]) !== stable(value)) diffs.push(key);
  }
  return diffs;
}

(async () => {
  const taskFile = required('task');
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  if (!Array.isArray(task.items) || !task.items.length) throw new Error('任务文件缺少 items');

  const action = arg('action', 'check');
  if (!['check', 'apply', 'verify'].includes(action)) throw new Error(`未知 action: ${action}`);
  if (action === 'apply' && arg('allow-write') !== 'true') throw new Error('写入必须显式传入 --allow-write true');

  const baseUrl = required('base-url').replace(/\/$/, '');
  const profile = required('profile');
  const backupDir = required('backup-dir');
  const playwrightCorePath = arg('playwright-core-path') || process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core';
  const { chromium } = require(playwrightCorePath);
  const launchOptions = { headless: true };
  const channel = arg('browser-channel');
  if (channel) launchOptions.channel = channel;

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(backupDir, `knowledge-task-${runId}`);
  const journal = {
    runId, action, taskFile, company: task.company || null, scope: task.scope || null,
    startedAt: new Date().toISOString(), entries: []
  };
  save(path.join(runDir, 'task.json'), task);

  const context = await chromium.launchPersistentContext(profile, launchOptions);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${baseUrl}/v2/agent-builder/knowledge-base`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!page.url().startsWith(baseUrl)) throw new Error(`页面跳转异常：${page.url()}`);

    const call = (endpoint, options = {}) => page.evaluate(async ({ endpoint, options }) => {
      const response = await fetch(endpoint, {
        credentials: 'include',
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
      });
      const json = await response.json();
      if (!response.ok || json.code !== 1) throw new Error(`${endpoint} HTTP=${response.status} code=${json.code} ${json.msg || ''}`);
      return json.data;
    }, { endpoint, options });
    const detail = id => call(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(id)}`);

    for (const item of task.items) {
      if (!item.id) throw new Error('当前执行器只支持原位更新，任务项必须有 id');
      if (item.after == null) throw new Error(`任务 ${item.id} 缺少 after`);

      const beforeCard = await detail(item.id);
      const current = contentOf(beforeCard);
      const expectedDiffs = checkExpected(beforeCard, item.expected || {});
      const entry = {
        id: item.id,
        note: item.note || null,
        currentSha256: sha(current),
        expectedDiffs,
        status: null
      };

      save(path.join(runDir, `${item.id}-before.json`), beforeCard);

      if (expectedDiffs.length) {
        entry.status = 'scope-conflict';
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        continue;
      }
      if (sameContent(current, item.after)) {
        entry.status = 'already-target';
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        continue;
      }
      if (item.before != null && !sameContent(current, item.before)) {
        entry.status = 'content-conflict';
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        continue;
      }
      if (action === 'verify') {
        entry.status = 'not-target';
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        continue;
      }

      const payload = payloadFrom(beforeCard, item.after);
      save(path.join(runDir, `${item.id}-payload.json`), payload);

      if (action === 'check') {
        entry.status = 'ready';
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        continue;
      }

      // 写入前最后再读一次，防止计划生成后被别人修改。
      const latest = await detail(item.id);
      if (!sameContent(contentOf(latest), current) || stable(businessMeta(latest)) !== stable(businessMeta(beforeCard))) {
        entry.status = 'prewrite-conflict';
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        continue;
      }

      entry.response = await call('/api/kbe/v1/knowledge-card/update', {
        method: 'POST', body: JSON.stringify(payload)
      });
      const afterCard = await detail(item.id);
      save(path.join(runDir, `${item.id}-after.json`), afterCard);

      const contentOk = sameContent(contentOf(afterCard), item.after);
      const metaOk = stable(businessMeta(afterCard)) === stable(businessMeta(beforeCard));
      entry.afterSha256 = sha(contentOf(afterCard));
      entry.status = contentOk && metaOk ? 'verified' : 'verify-failed';
      journal.entries.push(entry);
      save(path.join(runDir, 'journal.json'), journal);
      if (!contentOk || !metaOk) throw new Error(`写入后回读不一致：${item.id}`);
    }
  } finally {
    await context.close();
  }

  journal.finishedAt = new Date().toISOString();
  save(path.join(runDir, 'journal.json'), journal);
  const summary = journal.entries.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {});
  console.log(JSON.stringify({ runDir, summary }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
