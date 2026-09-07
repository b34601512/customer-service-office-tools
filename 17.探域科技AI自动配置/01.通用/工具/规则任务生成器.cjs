// 通用离线工具：从知识卡快照 + 业务规则JSON生成 before/after 任务。
// 不访问后台、不写入后台；业务正文、型号、ID、替换规则都放在公司专用JSON中。
const fs = require('fs');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function required(name) {
  const v = arg(name);
  if (!v) throw new Error(`缺少参数 --${name}`);
  return v;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function stable(v) {
  return JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
}
function content(card) { return (card.content || []).map(x => String(x?.content ?? '')).join('\n'); }
function normalizeCards(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.cards)) return raw.cards;
  if (Array.isArray(raw.results)) return raw.results;
  if (Array.isArray(raw.data?.results)) return raw.data.results;
  throw new Error('无法从snapshot识别知识卡数组');
}
function listIds(card, key) {
  return (card.includeCondition?.[key] || []).flatMap(x => [
    x.thirdShopId, x.spuId, ...(Array.isArray(x.skuIds) ? x.skuIds : [])
  ]).filter(Boolean).map(String);
}
function matches(card, where = {}) {
  const body = content(card);
  if (where.ids?.length && !where.ids.map(String).includes(String(card.id))) return false;
  if (where.ifOpen != null && Boolean(card.ifOpen) !== Boolean(where.ifOpen)) return false;
  if (where.types?.length && !where.types.map(String).includes(String(card.type))) return false;
  if (where.titleIncludes?.some(x => !String(card.title || '').includes(x))) return false;
  if (where.contentIncludes?.some(x => !body.includes(x))) return false;
  if (where.contentExcludes?.some(x => body.includes(x))) return false;
  if (where.titleRegex && !(new RegExp(where.titleRegex, where.titleRegexFlags || '')).test(String(card.title || ''))) return false;
  if (where.contentRegex && !(new RegExp(where.contentRegex, where.contentRegexFlags || '')).test(body)) return false;
  if (where.shopIds?.length) {
    const ids = listIds(card, 'shop');
    if (!where.shopIds.map(String).some(x => ids.includes(x))) return false;
  }
  if (where.spuIds?.length) {
    const ids = listIds(card, 'spu');
    if (!where.spuIds.map(String).some(x => ids.includes(x))) return false;
  }
  return true;
}
function applyTransforms(text, transforms = []) {
  let out = text;
  for (const t of transforms) {
    if (t.type === 'replace-literal') {
      const from = String(t.from ?? '');
      if (!from) throw new Error('replace-literal 缺少 from');
      const parts = out.split(from);
      if (t.requireMatch !== false && parts.length === 1) throw new Error(`未找到待替换文本: ${from.slice(0, 80)}`);
      out = parts.join(String(t.to ?? ''));
    } else if (t.type === 'replace-regex') {
      const re = new RegExp(t.pattern, t.flags || 'g');
      if (t.requireMatch !== false && !re.test(out)) throw new Error(`正则未匹配: ${t.pattern}`);
      re.lastIndex = 0;
      out = out.replace(re, String(t.to ?? ''));
    } else if (t.type === 'append') {
      out += String(t.text ?? '');
    } else if (t.type === 'prepend') {
      out = String(t.text ?? '') + out;
    } else {
      throw new Error(`未知transform: ${t.type}`);
    }
  }
  return out;
}
function expectedMeta(card) {
  return {
    type: card.type,
    ifOpen: card.ifOpen,
    includeCondition: card.includeCondition,
    excludeCondition: card.excludeCondition,
    orderStatus: card.orderStatus
  };
}

(() => {
  const snapshotFile = required('snapshot');
  const rulesFile = required('rules');
  const outputFile = required('output');
  const cards = normalizeCards(readJson(snapshotFile));
  const spec = readJson(rulesFile);
  if (!Array.isArray(spec.rules) || !spec.rules.length) throw new Error('规则文件缺少 rules');

  const output = {
    company: spec.company || null,
    scope: spec.scope || null,
    sourceSnapshot: snapshotFile,
    sourceRules: rulesFile,
    generatedAt: new Date().toISOString(),
    items: [],
    report: []
  };
  const seen = new Set();

  for (const rule of spec.rules) {
    const candidates = cards.filter(card => matches(card, rule.where || {}));
    const report = { name: rule.name || 'unnamed', candidates: candidates.length, changed: 0, unchanged: 0 };
    for (const card of candidates) {
      const before = content(card);
      let after;
      try {
        after = applyTransforms(before, rule.transforms || []);
      } catch (error) {
        error.message = `[${rule.name || 'unnamed'}][${card.id}] ${error.message}`;
        throw error;
      }
      if (after === before) {
        report.unchanged++;
        continue;
      }
      if (seen.has(String(card.id))) throw new Error(`同一知识卡被多个规则修改，请合并规则: ${card.id}`);
      seen.add(String(card.id));
      output.items.push({
        id: card.id,
        note: rule.note || rule.name || null,
        before: [before],
        after: [after],
        expected: expectedMeta(card)
      });
      report.changed++;
    }
    if (rule.requireCandidates !== false && candidates.length === 0) throw new Error(`规则没有匹配任何知识卡: ${rule.name || 'unnamed'}`);
    output.report.push(report);
  }

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({ cards: cards.length, tasks: output.items.length, report: output.report, output: outputFile }, null, 2));
})();
