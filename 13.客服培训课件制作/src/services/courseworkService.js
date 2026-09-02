// 课件生成编排（纯业务）：聊天记录文件 + 解析文件 → 成品 HTML + 自检报告
// 这是 TUI 与未来 AI 无界面运行共同调用的"单一真源"入口。
const fs = require('fs');
const path = require('path');
const { readChat, reviewFileFor } = require('./chatStore');
const { readReview, validateReview, blankReview } = require('./reviewStore');
const { renderCourseware } = require('./renderCourseware');
const { runSelfCheck, summarize } = require('./selfCheck');
const { sanitize } = require('./paths');

/**
 * 生成课件。返回 { status, ... }
 *   status='ok'        → htmlPath, checkItems, report
 *   status='needReview'→ 缺 AI 解析文件：返回 reviewPath 与提示
 *   status='invalid'   → 解析文件校验不过：errors
 */
async function generateCourseware(ws, { chatFile, reviewFile, outputName } = {}) {
  ws.ensure();
  const chat = readChat(ws, chatFile);
  const rel = reviewFileFor(ws, chatFile);
  const reviewPath = reviewFile || rel.file;

  if (!fs.existsSync(reviewPath)) {
    const base = sanitize(rel.base);
    const blank = blankReview(chat, base);
    blank._base = base;
    writeReviewLocal(ws, blank);
    return {
      status: 'needReview',
      chatFile,
      reviewPath,
      message: '还没有 AI 解析文件。已生成空白模板，请让 AI 按 SKILL.md 契约填写后重试。'
    };
  }

  const review = readReview(ws, path.basename(reviewPath));
  const check = validateReview(chat, review);
  if (!check.ok) {
    return { status: 'invalid', chatFile, reviewPath, errors: check.errors, warnings: check.warnings };
  }

  const { html, report } = await renderCourseware(chat, review);
  const checkItems = runSelfCheck(html, { review, report });

  // 落盘到 runtime/outputs/<月份目录>/<outputName>
  const dir = path.join(ws.dirs.outputs, report.monthDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = outputName || review.outputName || `${sanitize(rel.base)}.html`;
  const outFile = path.join(dir, name);
  fs.writeFileSync(outFile, html, 'utf8');

  return { status: 'ok', chatFile, reviewPath, htmlPath: outFile, checkItems, report };
}

function writeReviewLocal(ws, review) {
  ws.ensure();
  const base = sanitize(review._base || '解析');
  const file = path.join(ws.dirs.review, `${base}.review.json`);
  const { _base, _templateHint, ...clean } = review;
  void _base; void _templateHint;
  fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf8');
  return file;
}

module.exports = { generateCourseware };
