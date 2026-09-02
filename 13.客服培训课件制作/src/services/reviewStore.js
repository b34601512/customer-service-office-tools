// 解析数据文件（AI 产出物）存取与校验（纯业务）
// 契约 courseware-review/1：
// {
//   format:'courseware-review/1',
//   scenario:'涨价应对',
//   title:'…', sub:'…', tagline:'…',
//   window:'2026-08-05', store:'…',
//   outputName:'涨价应对案例演示.html',
//   overlays:[ { i:消息下标, note:'节点标签', bad:true, insight:'解析块id', textOverride:'脱敏/改写文本' } ],
//   insights:{ 解析块id:'<details class="insight">…</details>' }
// }
const fs = require('fs');
const path = require('path');
const { sanitize } = require('./paths');

const FORMAT = 'courseware-review/1';

/** 从聊天记录生成空白解析文件（供 AI 填写） */
function blankReview(chat, base) {
  return {
    format: FORMAT,
    scenario: '',
    title: '',
    sub: '',
    tagline: '',
    window: chat.meta.window || '',
    store: chat.meta.store || '',
    outputName: `${sanitize(chat.meta.customer || chat.meta.window || '课件')}.html`,
    overlays: [],
    insights: {},
    _templateHint: '由 AI 按 SKILL.md 契约填写：overlays 挂到消息下标 i，insights 提供 <details> 解析块'
  };
}

/** 校验解析文件与聊天记录的一致性 */
function validateReview(chat, review) {
  const errors = [];
  const warnings = [];
  if (!review || typeof review !== 'object') return { ok: false, errors: ['解析文件不是对象'], warnings };
  if (review.format && review.format !== FORMAT) errors.push(`format 不是 ${FORMAT}`);
  if (!Array.isArray(review.overlays)) errors.push('overlays 必须是数组');
  const seen = new Set();
  const insightRefs = new Set();
  if (Array.isArray(review.overlays)) {
    review.overlays.forEach((o, k) => {
      if (!o || typeof o !== 'object') { errors.push(`overlays[${k}] 不是对象`); return; }
      const i = o.i;
      if (!Number.isInteger(i)) { errors.push(`overlays[${k}].i 必须是整数`); return; }
      if (i < 0 || i >= chat.messages.length) errors.push(`overlays[${k}].i=${i} 越界（消息共 ${chat.messages.length} 条）`);
      if (seen.has(i)) errors.push(`overlays[${k}].i=${i} 重复`);
      seen.add(i);
      if (o.bad && !o.insight) warnings.push(`消息[${i}] 标记了可优化但没给解析块 insight`);
      if (o.insight) insightRefs.add(o.insight);
    });
  }
  if (!review.insights || typeof review.insights !== 'object') errors.push('insights 必须是对象');
  else {
    for (const ref of insightRefs) if (!(ref in review.insights)) errors.push(`overlays 引用了不存在的解析块：${ref}`);
    for (const key of Object.keys(review.insights)) {
      const html = String(review.insights[key] || '');
      if (!/<details class="insight[\s"]/.test(html)) errors.push(`解析块 ${key} 不是 <details class="insight"> 结构`);
    }
    if (!review.title) warnings.push('缺少 title（会用默认标题）');
  }
  return { ok: errors.length === 0, errors, warnings };
}

function listReviewFiles(ws) {
  return ws.listJson(ws.dirs.review);
}

function readReview(ws, fileName) {
  const file = path.join(ws.dirs.review, fileName);
  if (!fs.existsSync(file)) throw new Error(`解析文件不存在：${fileName}`);
  let review;
  try {
    review = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`解析文件损坏 ${fileName}: ${e.message}`);
  }
  return review;
}

function writeReview(ws, review) {
  ws.ensure();
  const base = sanitize(review._base || (review.window ? `${review.window}_${review.scenario || '课件'}` : '解析'));
  const fileName = `${base}.review.json`;
  const { _base, _templateHint, ...clean } = review;
  void _base; void _templateHint;
  const file = path.join(ws.dirs.review, fileName);
  fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf8');
  return { fileName, file };
}

module.exports = { FORMAT, blankReview, validateReview, listReviewFiles, readReview, writeReview };
