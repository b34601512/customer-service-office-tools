// 通用工具：按任务JSON安全更新探域知识卡。
// 默认只检查，不写入；写入必须 --action apply --allow-write true。
// 业务字段（绑店/范围/启用状态等）默认**不许变**：只有任务文件带 businessPatch + approvedBy（客服主管/经理姓名）
// 且命令行显式 --allow-business-change true 时，才允许按 businessPatch 改写这些字段（写入后按"补丁后的期望值"回读核对）。
// 支持三种任务项：①带 id 的原位更新；②不带 id + 带 title 的新建（save），新建默认 stopped（ifOpen:false），
// 且同标题已存在时不新建、不改写（status=title-conflict，交给调用方决定）；③带 id + delete:true 的删除（破坏性，见下）。
// 删除（item.delete=true）为破坏性操作：任务文件必须带 approvedBy（客服主管/经理姓名），命令行必须显式 --allow-delete true；
// 删前保存完整 detail、写前重读，删后回读「detail 消失 + 全量列表不含该 id」才算 deleted-verified。
// 删除核对口径（2026-10-02 D27 修正）：page 接口删除后 total 计数会滞后（results 先减、total 后减，实测约 1~2 分钟），
// 不能用 rows.length >= total 判全量；改为「预期行数」：本次 run 每次 verified 删除 -1，行数多/少都算未定（fail-closed）。
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
  if (out.excludeCondition == null) out.excludeCondition = EMPTY_SCOPE();
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
const CONDITION_KEYS = ['includeCondition', 'excludeCondition'];
const PATCH_FORBIDDEN = ['id', 'content', 'lastUpdatedAt'];
function assertPatchShape(patch) {
  for (const key of Object.keys(patch || {})) {
    if (!FIELDS.includes(key) || PATCH_FORBIDDEN.includes(key)) {
      throw new Error(`businessPatch 不允许包含字段 ${key}（只允许业务字段，正文/ID 必须走 after）`);
    }
  }
}
// 业务补丁：条件类字段按键覆盖（patch.includeCondition.shop 整体替换原数组），其余字段直接替换。
function mergeBusinessPatch(meta, patch) {
  assertPatchShape(patch);
  const out = { ...meta };
  for (const [key, value] of Object.entries(patch || {})) {
    if (CONDITION_KEYS.includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...(meta[key] || {}), ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}
function expectedBusinessAfter(card, patch) {
  return mergeBusinessPatch(businessMeta(card), patch);
}
// 只有“正文 + 业务字段”都已到位才算已完成；只改绑店（正文不动）时不能被当成 already-target 跳过。
function atTarget({ currentContent, after, currentBusiness, expectBusiness }) {
  return sameContent(currentContent, after) && stable(currentBusiness) === stable(expectBusiness);
}
// 红线锁：改绑店/范围等业务字段属破坏性变更，必须有人确认（主管/经理）且显式放行。
function assertBusinessChangeAllowed({ patch, approvedBy, allowFlag }) {
  if (!patch) return false;
  assertPatchShape(patch);
  if (!Object.keys(patch).length) return false;
  if (!String(approvedBy || '').trim()) {
    throw new Error('业务字段变更（绑店/范围等）必须在任务文件里写明 approvedBy（确认的客服主管/经理姓名）');
  }
  if (allowFlag !== 'true') {
    throw new Error('业务字段变更必须显式传入 --allow-business-change true（确认后才放行）');
  }
  return true;
}
// 红线锁：删除知识卡是不可逆操作，必须有人确认（主管/经理）且显式放行。
function assertDeleteAllowed({ deleteRequested, approvedBy, allowFlag }) {
  if (!deleteRequested) return false;
  if (!String(approvedBy || '').trim()) {
    throw new Error('删除知识卡（破坏性操作）必须在任务文件里写明 approvedBy（确认的客服主管/经理姓名）');
  }
  if (allowFlag !== 'true') {
    throw new Error('删除知识卡必须显式传入 --allow-delete true（主管/经理确认后才放行）');
  }
  return true;
}
const EMPTY_SCOPE = () => ({ spu: [], shop: [], rules: [], productGroupId: [], sellerGroup: [], platform: [] });const slug = (v) => String(v).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 60) || 'card';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 新建后回读校验（纯函数，好测）：期望值来自**任务书**（business），
 *  不再硬编码「新建=停用、不绑店」——2026-10-01 发现：任务书写 ifOpen:true / 绑店时，旧硬编码会把正确结果误判成 created-verify-failed。 */
function verifyCreated({ created, business = {}, after } = {}) {
  const contentOk = sameContent(contentOf(created), after);
  const openOk = (created.ifOpen === true) === (business.ifOpen === true);
  const scopeOk = stable((created.includeCondition || {}).shop || []) === stable((business.includeCondition || {}).shop || []);
  return { contentOk, openOk, scopeOk };
}

/** 删除后回读判定（纯函数，好测）：
 *  探域 page 接口在卡消失后 total 计数会滞后（results 先减、total 后减），所以删除核对不依赖 total，
 *  改用「预期行数」：expectAfter = 本次 run 的已知卡数 - 1；只有「detail 消失 + rows 不含该 id + rows.length === expectAfter」才算过。
 *  rows 比预期多（并行加卡）或比预期少（并行删卡）都算未定，交给调用方继续轮询或报错（fail-closed）。 */
function deleteReadbackVerdict({ detailStill, rows, id, expectAfter } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const inList = list.some(c => c && c.id === id);
  const countOk = list.length === expectAfter;
  return { inList, countOk, gone: !detailStill && !inList && countOk };
}

async function main() {
  const taskFile = required('task');
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  if (!Array.isArray(task.items) || !task.items.length) throw new Error('任务文件缺少 items');

  const action = arg('action', 'check');
  if (!['check', 'apply', 'verify'].includes(action)) throw new Error(`未知 action: ${action}`);
  if (action === 'apply' && arg('allow-write') !== 'true') throw new Error('写入必须显式传入 --allow-write true');

  const businessPatch = task.businessPatch || null;
  if (businessPatch && action === 'apply') {
    assertBusinessChangeAllowed({ patch: businessPatch, approvedBy: task.approvedBy, allowFlag: arg('allow-business-change') });
  } else if (businessPatch) {
    console.error('[只读] 本次是 check/verify：businessPatch 只用于计算“计划 payload / 期望值”，不写入后台。');
  }

  const deleteItems = task.items.filter(x => x.delete === true);
  if (deleteItems.length && action === 'apply') {
    assertDeleteAllowed({ deleteRequested: true, approvedBy: task.approvedBy, allowFlag: arg('allow-delete') });
  } else if (deleteItems.length) {
    console.error('[只读] 本次是 check/verify：删除项只做删前核对，不写后台、不删除。');
  }

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
    approvedBy: task.approvedBy || null,
    businessPatchKeys: businessPatch ? Object.keys(businessPatch) : null,
    deleteIds: deleteItems.map(x => x.id),
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
        // 实测（2026-10-01）：该接口忽略 pageNo/pageIndex，翻页永远返回第一页；分页无效，必须一次拉全。
        // 拉不全就报错停下（缺失全量时禁止继续判断防重复/消失）。
        const data = await call('/api/kbe/v1/knowledge-card/page', {
          method: 'POST', body: JSON.stringify({ pageNo: 1, pageSize: 5000 })
        });
        const rows = (data && data.results) || [];
        const total = data && typeof data.total === 'number' ? data.total : rows.length;
        if (rows.length < total) {
          throw new Error(`全库未拉全：results=${rows.length} < total=${total}（接口忽略 pageNo，需提高 pageSize）`);
        }
        cachedCards = rows;
      }
      return cachedCards;
    };

    // 删除核对的「预期行数」基线：第一次真删前拉一次当前行数（不依赖会滞后的 total）。
    let deleteKnownRows = null;

    for (const item of task.items) {
      // ---------- 删除（item.delete === true；严格顺序：读前 → SHA 对照 → 写前重读 → 删 → 回读） ----------
      if (item.delete === true) {
        if (!item.id) throw new Error('删除任务项必须提供 id');
        const entry = {
          id: item.id,
          note: item.note || null,
          expectedSha256: item.expectedSha256 || null,
          status: null
        };
        let beforeCard = null;
        try {
          beforeCard = await detail(item.id);
        } catch (error) {
          beforeCard = null;
          entry.readError = String(error.message || error);
        }
        if (!beforeCard) {
          entry.status = 'already-deleted';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        entry.title = beforeCard.title || null;
        entry.currentSha256 = sha(contentOf(beforeCard));
        entry.currentBusinessSha256 = sha(businessMeta(beforeCard));
        save(path.join(runDir, `${item.id}-before.json`), beforeCard);
        if (entry.expectedSha256 && entry.currentSha256 !== entry.expectedSha256) {
          entry.status = 'sha-conflict';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        if (action === 'check') {
          entry.status = 'ready';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        if (action === 'verify') {
          entry.status = 'not-deleted';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        // 写前再读一次，确认没被并行修改。
        const latest = await detail(item.id);
        if (!sameContent(contentOf(latest), contentOf(beforeCard)) || stable(businessMeta(latest)) !== stable(businessMeta(beforeCard))) {
          entry.status = 'prewrite-conflict';
          journal.entries.push(entry);
          save(path.join(runDir, 'journal.json'), journal);
          continue;
        }
        // 删除前记录计数基线：page 接口的 total 会滞后，只信当次 rows 行数。
        if (deleteKnownRows == null) {
          const base = await call('/api/kbe/v1/knowledge-card/page', {
            method: 'POST', body: JSON.stringify({ pageNo: 1, pageSize: 5000 })
          });
          const baseRows = (base && base.results) || [];
          if (!baseRows.length) throw new Error('删除核对基线拉取为空，停止（fail-closed）');
          deleteKnownRows = baseRows.length;
          entry.baseline = { rows: baseRows.length, total: base && base.total != null ? base.total : null, at: new Date().toISOString() };
        }
        entry.response = await call('/api/kbe/v1/knowledge-card/batch-delete', {
          method: 'POST', body: JSON.stringify({ cardIds: [item.id] })
        });
        // 回读：detail 消失 + 列表不含该 id + 行数恰为「已知卡数 - 1」，三条都满足才算 verified
        // （total 计数会滞后，不参与判定；行数多/少都算未定，短轮询）。
        let gone = false;
        let observed = null;
        const expectAfter = deleteKnownRows - 1;
        for (let attempt = 0; attempt < 5 && !gone; attempt++) {
          if (attempt) await sleep(3000);
          let detailStill = false;
          let detailError = null;
          try {
            const d = await detail(item.id);
            detailStill = !!(d && d.id);
          } catch (error) {
            detailStill = false;
            detailError = String(error.message || error);
          }
          const data = await call('/api/kbe/v1/knowledge-card/page', {
            method: 'POST', body: JSON.stringify({ pageNo: 1, pageSize: 5000 })
          });
          const rows = (data && data.results) || [];
          const verdict = deleteReadbackVerdict({ detailStill, rows, id: item.id, expectAfter });
          observed = {
            attempt: attempt + 1, detailStill, detailError, inList: verdict.inList,
            rowsReturned: rows.length, expectAfter, countOk: verdict.countOk,
            total: data && data.total != null ? data.total : null
          };
          gone = verdict.gone;
        }
        entry.deleteReadback = observed;
        entry.status = gone ? 'deleted-verified' : 'delete-verify-pending';
        if (gone) deleteKnownRows = expectAfter;
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        if (!gone) throw new Error(`删除后回读未确认消失：${item.id}`);
        continue;
      }

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
        const 校验 = verifyCreated({ created, business, after: item.after });
        const { contentOk, openOk, scopeOk } = 校验;
        entry.createdId = created.id;
        entry.afterSha256 = sha(contentOf(created));
        entry.checks = 校验;
        entry.status = contentOk && openOk && scopeOk ? 'created-verified' : 'created-verify-failed';
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

      const expectBusiness = businessPatch ? expectedBusinessAfter(beforeCard, businessPatch) : businessMeta(beforeCard);
      entry.businessPatch = businessPatch ? 'patched' : 'unchanged';
      entry.expectBusinessSha256 = sha(expectBusiness);

      if (expectedDiffs.length) {
        entry.status = 'scope-conflict';
        journal.entries.push(entry);
        save(path.join(runDir, 'journal.json'), journal);
        continue;
      }
      if (atTarget({ currentContent: current, after: item.after, currentBusiness: businessMeta(beforeCard), expectBusiness })) {
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

      let payload = payloadFrom(beforeCard, item.after);
      if (businessPatch) payload = mergeBusinessPatch(payload, businessPatch);
      entry.approvedBy = task.approvedBy || null;
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
      const metaOk = stable(businessMeta(afterCard)) === stable(expectBusiness);
      entry.afterSha256 = sha(contentOf(afterCard));
      entry.scopeShop = {
        before: (beforeCard.includeCondition || {}).shop || [],
        after: (afterCard.includeCondition || {}).shop || []
      };
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
  console.log(JSON.stringify({ runDir, summary, approvedBy: task.approvedBy || null }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  FIELDS, stable, sha, segments, contentOf, sameContent, payloadFrom, businessMeta, checkExpected,
  mergeBusinessPatch, expectedBusinessAfter, atTarget, assertPatchShape, assertBusinessChangeAllowed, assertDeleteAllowed, verifyCreated,
  deleteReadbackVerdict
};
