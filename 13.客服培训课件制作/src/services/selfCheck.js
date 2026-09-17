// 铁律自检（纯业务）：对生成的 HTML 做程序化检查，返回逐条报告项
// 依据经验模板铁律：无目录/无结尾总结卡、就地解析、客服右客户左、
// 无字面 <br/>、无乱码、客户ID 默认脱敏+眼睛按钮、图片全部内嵌、
// 解析块必须有显而易见的「点击展开」按钮；建议话术收尾必须是逼单（不能问「需要吗？」）。

function runSelfCheck(html, { review, report, chat }) {
  const items = [];
  const add = (status, text) => items.push({ status, text });

  // 1) 无左侧目录 / 无独立结尾总结卡片
  add((!html.includes('class="toc"') && !/<nav/i.test(html)) ? 'ok' : 'fail', '无左侧目录/锚点栏');
  add(!html.includes('结尾总结') && !html.includes('class="summary-card"') ? 'ok' : 'fail', '无独立结尾总结卡片');
  add(!html.includes('class="header"') ? 'ok' : 'fail', '无顶部大标题/摘要卡（打开即正文）');

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

  // 9) 机器人自动回复/系统消息必须全部画出来
  // 漏画它们会把“机器人已答完、客服只发了个表情”误判成“客服不答问题”，冤枉客服
  const sysExpected = ((report && report.systemCount) !== undefined)
    ? report.systemCount
    : ((chat && chat.messages) || []).filter((m) => m.role === 'system').length;
  const sysActual = (html.match(/class="msg from-sys"/g) || []).length;
  if (sysExpected > 0) {
    add(sysActual === sysExpected ? 'ok' : 'fail', `机器人/系统消息全部渲染（期望 ${sysExpected}，实际 ${sysActual}）`);
  } else {
    const fromFullLog = /咚咚全量|全量记录/.test(String((chat && chat.meta && chat.meta.sourceNote) || ''));
    add(fromFullLog ? 'ok' : 'warn', fromFullLog ? '该会话无机器人/系统消息（已用全量口径核对）' : '取数疑似旧口径（无机器人/系统消息）→ 用 fetch:full 全量核对');
  }

  // 10) 解析块必须一眼看出能点（2026-09-15 用户反馈：不明显，不知道能点）
  // 渲染器会给每个 summary 自动注入统一按钮；这里守铁律，防止以后改渲染器又弄丢
  const btnCount = (html.match(/class="sum-btn"/g) || []).length;
  add(expected === 0 || btnCount >= expected ? 'ok' : 'fail', `解析块有显而易见的「点击展开」按钮（期望 ≥ ${expected}，实际 ${btnCount}）`);

  // 11) 收尾话术必须是逼单，不能问「需要吗？」（2026-09-15 用户要求）
  // 客户前面关注过配件/赠品等，就用它做钩子把单推下去；开放式问句会把决定权又丢回给客户
  const closings = closingTextsOf(review.insights);
  const openEnded = closings.filter((t) => /(需要吗|要不要|需不需要|还需要吗|还需要什么)/.test(t));
  add(openEnded.length === 0 ? 'ok' : 'fail', `建议话术收尾不用开放式问句（疑似 ${openEnded.length} 处${openEnded.length ? '：' + openEnded.slice(0, 2).join(' / ') : ''}）`);

  // 12) 逼单收尾句用 .closer 高亮（有 good 对比栏时给提醒，不阻断）
  const closerCount = (html.match(/class="closer"/g) || []).length;
  const hasGoodCol = /class="col good"/.test(html);
  add(!hasGoodCol || closerCount > 0 ? 'ok' : 'warn', `逼单收尾句已高亮（closer ${closerCount} 处）`);

  // 13) 尽量发现做得好的地方并鼓励（2026-09-17 用户要求）
  // 引导，不是硬指标：只报个数，不给 warn（免得为了消灭提醒去硬夸、尬夸，用户明确不要）
  const insightIds = Object.keys(review.insights || {});
  const badIds = new Set((review.overlays || []).filter((o) => o.bad && o.insight).map((o) => o.insight));
  const positiveCount = insightIds.filter((id) => !badIds.has(id)).length;
  add('ok', `正面解析 ${positiveCount} / 解析总数 ${insightIds.length}（有真实可夸的就鼓励，没有不硬夸）`);

  // 14) 解析只讲“到它为止”的内容（就地视角）—— 不能提前引用后面才发生的对话（2026-09-17 用户要求）
  const norm = (v) => String(v || '').replace(/<[^>]*>/g, ' ')
    .replace(/[\s，。！？、；：（）()【】“”"'·~～]/g, '');
  const futureRefs = [];
  if (chat && Array.isArray(chat.messages)) {
    for (const o of review.overlays || []) {
      if (!o.insight || !(review.insights || {})[o.insight]) continue;
      const text = norm(review.insights[o.insight]);
      for (let j = o.i + 1; j < chat.messages.length; j++) {
        const later = norm(chat.messages[j].text);
        if (later.length >= 4 && text.includes(later)) futureRefs.push(`解析 ${o.insight} 引用了第 ${j + 1} 条后面对话的原话`);
      }
    }
  }
  add(futureRefs.length === 0 ? 'ok' : 'warn',
    `解析只讲“到它为止”的内容（提前引用后面对话 ${futureRefs.length} 处${futureRefs.length ? '：' + [...new Set(futureRefs)].slice(0, 2).join(' / ') : ''}）`);

  // 15) 别把“先回一句短话抢响应时间”当缺点（2026-09-17 用户：客服为了响应时间先发“您好”）
  const greetingOnly = [];
  for (const [id, raw] of Object.entries(review.insights || {})) {
    const q = String(raw).match(/<div class="col bad">[\s\S]*?<p>([\s\S]*?)<\/p>/);
    if (!q) continue;
    const quote = q[1].replace(/<[^>]*>/g, '').replace(/[\s！!~～。，,.、]/g, '');
    if (quote.length <= 6 && /^(您好|你好|您们好|亲|亲亲|在的|在呢|在吗|来了|稍等|好的|嗯嗯)$/.test(quote)) greetingOnly.push(`解析 ${id}（“${quote}”）`);
  }
  add(greetingOnly.length === 0 ? 'ok' : 'warn',
    `开场短句不算缺点（疑似把问候当问题 ${greetingOnly.length} 处${greetingOnly.length ? '：' + greetingOnly.slice(0, 2).join(' / ') : ''}）`);

  // 16) 到手价以主图为准：建议话术里不能用“以…价格为准”敷衍（黎经理 2026-09-17 口径）
  const vaguePrice = [];
  for (const [id, raw] of Object.entries(review.insights || {})) {
    const g = String(raw).match(/<div class="col good">[\s\S]*?<p>([\s\S]*?)<\/p>/);
    if (!g) continue;
    const said = g[1].replace(/<[^>]*>/g, '');
    const hit = said.match(/以[^。；，]{0,8}价格为准/);
    if (hit) vaguePrice.push(`解析 ${id}（“${hit[0]}”）`);
  }
  add(vaguePrice.length === 0 ? 'ok' : 'warn',
    `建议话术不用“以价格为准”敷衍（到手价按主图讲 ${vaguePrice.length} 处${vaguePrice.length ? '：' + vaguePrice.slice(0, 2).join(' / ') : ''}）`);

  return items;
}

/** 取每条建议话术/要点列表的最后一句，用于检查收尾语气 */
function closingTextsOf(insights) {
  const texts = [];
  for (const raw of Object.values(insights || {})) {
    const html = String(raw || '');
    for (const part of html.split(/<div class="col good">/).slice(1)) {
      const p = part.match(/<p>([\s\S]*?)<\/p>/);
      if (p) texts.push(lastSentence(p[1]));
    }
    const tips = html.match(/<ul class="tips">([\s\S]*?)<\/ul>/);
    if (tips) for (const li of tips[1].match(/<li>[\s\S]*?<\/li>/g) || []) texts.push(lastSentence(li));
  }
  return texts.filter(Boolean);
}

function lastSentence(html) {
  // 引号里提到“需要吗”是在讲规则，不算收尾话术本身：先把引号内容去掉
  const t = String(html).replace(/<[^>]*>/g, ' ')
    .replace(/“[^”]*”/g, ' ').replace(/"[^"]*"/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const parts = t.split(/[。！？!?~～]+/).map((x) => x.trim()).filter(Boolean);
  return parts[parts.length - 1] || t;
}

function summarize(items) {
  const fail = items.filter((x) => x.status === 'fail').length;
  const warn = items.filter((x) => x.status === 'warn').length;
  return { fail, warn, ok: items.length - fail - warn };
}

module.exports = { runSelfCheck, summarize };
