// 通用工具：按任务JSON安全更新探域知识卡。
// 默认只检查，不写入；写入必须 --action apply --allow-write true。
// 支持两种任务项：①带 id 的原位更新；②不带 id + 带 title 的新建（save），新建默认 stopped（ifOpen:false），
// 且同标题已存在时不新建、不改写（status=title-conflict，交给调用方决定）。
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
  'includeCondition', 'excludeCondition', 'timeliness', 'cycleTimeliness', 'orderStatus',
  'lastUpdatedAt'
];
function payloadFrom(card, after) {
  const out = {};
  for (const key of FIELDS) out[key] = card[key];
  out.content = segments(after).map(content => ({ content }));
  return out;
}
function businessMeta(card) {
  const out = {};
  for (const key of FIELDS) if (key !== 'content' && key !== 'lastUpdatedAt') out[key] = card[key];
  if (out.excludeCondition && typeof out.excludeCondition === 'object') {
    for (const key of ['spu', 'shop', 'rules', 'productGroupId', 'sellerGroup', 'platform']) {
      if (out.excludeCondition[key] == null) out.excludeCondition[key] = [];
    }
  }
  return out;
}
function checkExpected(card, expected = {}) {
  const diffs = [];
  for (const [key, value] of Object.entries(expected)) {
    if (stable(card[key]) !== stable(value)) diffs.push(key);
  }
  return diffs;
}
const EMPTY_SCOPE = () => ({ spu: [], shop: [], rules: [], productGroupId: [], sellerGroup: [], platform: [] });
const slug = (v) => String(v).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 60) || 'card';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    // 微应用加载后会自行路由（可能造成 evaluate 上下文销毁），先等一下再发请求
    await page.waitForTimeout(3000);

    const callOnce = (endpoint, options = {}) => page.evaluate(async ({ endpoint, options }) => {
      const response = await fetch(endpoint, {
        credentials: 'include',
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
      });
      const json = await response.json();
      if (!response.ok || json.code !== 1) throw new Error(`${endpoint} HTTP=${response.status} code=${json.code} ${json.msg || ''}`);
      return json.data;
    }, { endpoint, options });
    const call = async (endpoint, options = {}) => {
      try {
        return await callOnce(endpoint, options);
      } catch (error) {
        if (!/Execution context was destroyed|Target closed|detached/i.test(String(error.message))) throw error;
        await page.waitForTimeout(5000);
        return callOnce(endpoint, options);
      }
    };
    const detail = id => call(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(id)}`);

    // 全量列表（新增任务需要按 title 防重复；同时用于回读核对）
    let cachedCards = null;
    const listAll = async (force) => {
      if (!cachedCards || force) {
        const data = await call('/api/kbe/v1/knowledge-card/page', {
          method: 'POST', body: JSON.stringify({ pageNo: 1, pageSize: 3000 })
        });
        cachedCards = (data && data.results) || [];
      }
      return cachedCards;
    };

    for (const item of task.items) {
      // ---------- 新建（无 id，必须有 title） ----------
      if (!item.id) {
        if (!item.title) throw new Error('新增任务项必须提供 title');
        if (item.after == null) throw new Error(`任务“${item.title}”缺少 after`);
        const cards = await listAll();
        const sameTitle = cards.filter(c => String(c.title || '') === String(item.title));
        const entry = {
          title: item.title,
          note: item.note || null,
          targetSha256: sha(segments(item.after)),
          existingIds: sameTitle.map(c => c.id),
          status: null
        };
        if (sameTitle.some(c => sameContent(contentOf(c), item.after))) {
          entry.status = 'already-target';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        if (sameTitle.length) {
          entry.status = 'title-conflict';
          for (const c of sameTitle) save(path.join(runDir, `existing-${slug(c.id)}.json`), c);
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        const business = item.business || {};
        const payload = {
          title: item.title,
          content: segments(item.after).map(content => ({ content })),
          labels: business.labels || [],
          ifBelievable: business.ifBelievable !== false,
          ifOpen: business.ifOpen === true, // 新建默认停用，必须显式写 true 才启用
          type: business.type || 'SHOP',
          orderStatus: business.orderStatus || [],
          timeliness: business.timeliness || null,
          cycleTimeliness: business.cycleTimeliness || null,
          includeCondition: business.includeCondition || EMPTY_SCOPE(),
          excludeCondition: business.excludeCondition || EMPTY_SCOPE()
        };
        save(path.join(runDir, `${slug(item.title)}-payload.json`), payload);
        if (action === 'check') {
          entry.status = 'ready';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        if (action === 'verify') {
          entry.status = 'not-found';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        entry.response = await call('/api/kbe/v1/knowledge-card/save', {
          method: 'POST', body: JSON.stringify(payload)
        });
        const returnedId = entry.response && (entry.response.id || (entry.response.result && entry.response.result.id));
        let created = null;
        for (let attempt = 0; attempt < 6 && !created; attempt++) {
          if (attempt) await sleep(3000);
          if (returnedId) {
            try { created = await detail(returnedId); } catch (_) { created = null; }
          }
          if (!created) {
            created = (await listAll(true)).find(c => String(c.title || '') === String(item.title)) || null;
          }
        }
        if (!created) {
          entry.status = 'created-awaiting-index';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        save(path.join(runDir, `${slug(created.id)}-created.json`), created);
        const contentOk = sameContent(contentOf(created), item.after);
        const openOk = created.ifOpen !== true;
        const scopeOk = stable((created.includeCondition || {}).shop || []) === stable([]);
        entry.createdId = created.id;
        entry.afterSha256 = sha(contentOf(created));
        entry.checks = { contentOk, openOk, scopeOk };
        entry.status = contentOk && openOk ? 'created-verified' : 'created-verify-failed';
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        if (entry.status !== 'created-verified') throw new Error(`新建后回读不一致：${item.title}`);
        continue;
      }

      // ---------- 原位更新 ----------
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
