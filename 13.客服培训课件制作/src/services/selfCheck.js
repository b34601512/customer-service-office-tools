// 铁律自检（纯业务）：对生成的 HTML 做程序化检查，返回逐条报告项
// 依据经验模板铁律：无目录/无结尾总结卡、就地解析、客服右客户左、
// 无字面 <br/>、无乱码、客户ID 默认脱敏+眼睛按钮、图片全部内嵌。

function runSelfCheck(html, { review, report }) {
  const items = [];
  const add = (status, text) => items.push({ status, text });

  // 1) 无左侧目录 / 无独立结尾总结卡片
  add((!html.includes('class="toc"') && !/<nav/i.test(html)) ? 'ok' : 'fail', '无左侧目录/锚点栏');
  add(!html.includes('结尾总结') && !html.includes('class="summary-card"') ? 'ok' : 'fail', '无独立结尾总结卡片');

  // 2) 就地解析：insight 数量与解析文件一致
  const expected = Object.keys(review.insights || {}).length;
  const actual = (html.match(/<details class="insight[\s"]/g) || []).length;
  add(actual === expected ? 'ok' : 'fail', `就地解析块数量一致（期望 ${expected}，实际 ${actual}）`);

  // 3) 消息顺序/角色样式
  add(html.includes('.from-kf') && html.includes('.from-cus') ? 'ok' : 'fail', '客服右/客户左样式存在');

  // 4) 无字面 <br/> 泄漏、无乱码
  add(!/&lt;br\/&gt;/i.test(html) ? 'ok' : 'fail', '无字面 <br/> 泄漏');
  add(!/\uFFFD/.test(html) ? 'ok' : 'fail', '无乱码字符');

  // 5) 客户ID 默认脱敏 + 眼睛按钮
  const hasCidCss = html.includes('.cid{display:none}') && html.includes('body.show-cid .cid{display:inline}');
  const hasToggle = html.includes('cid-toggle');
  add(hasCidCss && hasToggle ? 'ok' : 'fail', '客户ID 默认脱敏 + 眼睛按钮');

  // 6) 图片全部内嵌（无外部 http 图片引用）
  const leftoverHttpImgs = (html.match(/<img src="https?:/g) || []).length;
  add(leftoverHttpImgs === 0 ? 'ok' : 'warn', `图片全部内嵌（剩余外部图片 ${leftoverHttpImgs} 张）`);

  // 7) 每个可优化标记都有对应解析块（由 overlays 保证）
  const badWithoutInsight = (review.overlays || []).filter((o) => o.bad && !o.insight).length;
  add(badWithoutInsight === 0 ? 'ok' : 'warn', `可优化标记均已挂解析块（未挂 ${badWithoutInsight} 处）`);

  // 8) 图片下载失败提示
  const fails = (report && report.imageFailures) || [];
  add(fails.length === 0 ? 'ok' : 'warn', `聊天图片下载（失败 ${fails.length} 张）`);

  return items;
}

function summarize(items) {
  const fail = items.filter((x) => x.status === 'fail').length;
  const warn = items.filter((x) => x.status === 'warn').length;
  return { fail, warn, ok: items.length - fail - warn };
}

module.exports = { runSelfCheck, summarize };
