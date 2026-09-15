// 课件 HTML 渲染（纯业务）：标准聊天记录 + 解析文件 → 单文件 HTML
// 样式：无目录、无结尾总结卡、无顶部大标题（打开即正文）、
// 客服蓝右/客户白左、<details> 就地内嵌、图片内嵌、客户ID 默认脱敏+眼睛按钮。
// 2026-09-15 美化版：白底解析卡 + 左侧绿色色条、柔和 chip、逼单收尾高亮（.closer）。
const { monthDirOf } = require('./paths');

/** HTML 转义；再把转义后的 <br/> 还原为真实换行标签 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/&lt;br\/&gt;/gi, '<br/>');
}

// 「点击可展开」必须一眼可见（2026-09-15 用户要求）：按钮由渲染器统一注入，AI 不必手写、也不会漏。
const TOGGLE_BTN = '<span class="sum-btn" aria-hidden="true"><span class="t-open">点击展开解析</span><span class="t-close">点击收起</span><span class="sum-caret">▾</span></span>';
const LEGACY_HINT_RE = /<span class="sum-hint"[^>]*>[\s\S]*?<\/span>\s*/gi;

/** 给解析块补统一的、明显的可点击按钮；旧文件里的文字提示（sum-hint）一并去掉，避免重复 */
function withToggleAffordance(html) {
  if (!html) return html;
  return String(html).replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (tag, inner) => {
    const cleaned = inner.replace(LEGACY_HINT_RE, '');
    if (/class="sum-btn"/.test(cleaned)) return tag.replace(inner, () => cleaned);
    return tag.replace(inner, () => cleaned + TOGGLE_BTN);
  });
}

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

async function embedImage(url) {
  try {
    const res = await fetch(url, { headers: { referer: 'https://kf.jd.com/' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = String(res.headers.get('content-type') || '');
    const mime = ctype.split(';')[0].trim() || MIME_BY_EXT[String(url).split('.').pop().toLowerCase()] || 'image/jpeg';
    return { ok: true, data: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function renderMessage(msg, overlay, insightHtml, imgMap) {
  const isCus = msg.role === 'customer';
  const isSys = msg.role === 'system';
  const cls = isSys ? 'from-sys' : isCus ? 'from-cus' : 'from-kf';
  const who = isSys ? `🔔 ${msg.label || '系统消息'}` : isCus ? '客户' : '客服';
  const noteBadge = overlay && overlay.note ? `<div class="note-mark">${esc(overlay.note)}</div>` : '';
  const badBadge = overlay && overlay.bad ? `<div class="key-mark"><span class="key-flag">◆ 可优化回复</span></div>` : '';
  let bubble;
  if (msg.img && imgMap[msg.img]) {
    const data = imgMap[msg.img].data;
    bubble = `<div class="bubble bubble-img">${esc(msg.text)}<img src="${data}" alt="图片" onclick="this.classList.toggle('zoom')"/></div>`;
  } else {
    bubble = `<div class="bubble">${esc(msg.text)}</div>`;
  }
  let html = `<div class="msg ${cls}">
    <div class="msg-body">
      <div class="msg-meta"><span class="who">${esc(who)}</span><span class="time">${esc((msg.time || '').slice(11, 16))}</span>${noteBadge}</div>
      ${bubble}
      ${badBadge}
    </div>
  </div>`;
  if (overlay && overlay.insight && insightHtml) html += insightHtml;
  return html;
}

/** 渲染主函数。返回 { html, report:{ imageFailures, messageCount, insightCount } } */
async function renderCourseware(chat, review) {
  const overlayMap = new Map();
  (review.overlays || []).forEach((o) => overlayMap.set(o.i, o));

  // 预下载所有图片
  const imgUrls = [...new Set(chat.messages.map((m) => m.img).filter(Boolean))];
  const imgMap = {};
  const imageFailures = [];
  for (const url of imgUrls) {
    const r = await embedImage(url);
    if (r.ok) imgMap[url] = r;
    else imageFailures.push({ url, error: r.error });
  }

  const chatArea = chat.messages.map((msg, i) => {
    const overlay = overlayMap.get(i);
    const insightHtml = overlay && overlay.insight ? withToggleAffordance(review.insights[overlay.insight]) : null;
    return renderMessage(msg, overlay, insightHtml, imgMap);
  }).join('');

  const customerLabel = chat.meta.customer || chat.meta.orderId || '';
  // 系统消息（机器人自动回复/欢迎语）必须画出来：漏掉它们会把“机器人已答、客服只发了个表情”当成客服不答问题。
  const hasSystem = chat.messages.some((m) => m.role === 'system');
  const sysCss = hasSystem ? '\n.from-sys{justify-content:center}.from-sys .msg-body{max-width:82%}\n.from-sys .msg-meta{justify-content:center}.from-sys .bubble{background:#f4f7fb;border:1px dashed #cfdaea;color:#5b6b80;font-size:12.5px;border-radius:12px;box-shadow:none}' : '';
  const sysHint = hasSystem ? '灰色虚线框＝机器人自动回复/系统消息。' : '';
  // 标题只进浏览器标签页（<title>）；页面内不再做大标题头/摘要卡，打开即正文。
  const title = review.title || `${chat.meta.customer || chat.meta.window || '客服'} 培训案例`;
  const store = review.store || chat.meta.store || '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>培训课件：${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;color:#1f2937;line-height:1.7;font-size:14px;background:#eef2f7;background-image:radial-gradient(900px 420px at 50% -160px,#e4eeff 0%,rgba(238,242,247,0) 72%);background-repeat:no-repeat}
.wrap{max-width:980px;margin:0 auto;padding:24px 16px 64px}
.card{background:#fff;border:1px solid rgba(226,232,240,.9);border-radius:18px;padding:20px 22px;box-shadow:0 12px 34px rgba(15,23,42,.07)}
.hint{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;color:#3f4c5f;background:linear-gradient(180deg,#f8fbff,#eef6ff);border:1px solid #dbeafe;border-radius:12px;padding:10px 14px;margin-bottom:16px;line-height:1.7}
.hint b{color:#1d4ed8}
.hint-ico{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#2563eb;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:2px}
.chat-area{background:linear-gradient(180deg,#fbfcfe,#f7f9fc);border:1px solid #e9eef6;border-radius:14px;padding:18px}
.session-title{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:800;color:#334155;background:#fff;border:1px solid #e8eef6;border-radius:12px;padding:9px 14px;margin-bottom:16px;box-shadow:0 1px 2px rgba(15,23,42,.03)}
.st-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block;margin-right:7px;box-shadow:0 0 0 3px rgba(34,197,94,.15)}
.cid{display:none}
body.show-cid .cid{display:inline}
.cid-toggle{background:#f8fafc;border:1px solid #dbe3ee;border-radius:999px;color:#64748b;font-size:12px;padding:3px 12px;cursor:pointer;font-weight:700;transition:.15s}
.cid-toggle:hover{color:#1d4ed8;border-color:#bfdbfe;background:#eff6ff}
.msg{display:flex;margin-bottom:10px}.msg-body{max-width:78%}
.from-cus{justify-content:flex-start;margin-right:auto}.from-kf{justify-content:flex-end;margin-left:auto}
.msg-meta{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#9aa6b8;margin-bottom:5px;flex-wrap:wrap}
.from-kf .msg-meta{flex-direction:row-reverse}.msg-meta .who{color:#51607a;font-weight:800}
.note-mark{font-size:10.5px;background:#fef3c7;color:#92400e;border-radius:999px;padding:1px 9px;font-weight:700}
.bubble{padding:10px 15px;border-radius:14px;font-size:14px;word-break:break-word;line-height:1.8}
.from-cus .bubble{background:#fff;border:1px solid #e6ecf5;border-top-left-radius:4px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.from-kf .bubble{background:linear-gradient(180deg,#4a8df8,#3b7cf0);color:#fff;border-top-right-radius:4px;box-shadow:0 3px 10px rgba(59,124,240,.24)}
.bubble-img img{display:block;max-width:260px;margin-top:8px;border-radius:10px;cursor:zoom-in;border:1px solid rgba(255,255,255,.4)}
.bubble-img img.zoom{max-width:100%}
.key-mark{margin-top:7px;display:flex;justify-content:flex-start}
.key-flag{background:#fff1f2;color:#be123c;border:1px solid #fecdd3;font-size:10.5px;font-weight:800;border-radius:999px;padding:2px 10px}
.insight{margin:14px 0 18px;border-radius:14px;overflow:hidden;border:1px solid #e8eef6;border-left:4px solid #22c55e;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,.05);transition:box-shadow .18s}
.insight[open]{box-shadow:0 8px 22px rgba(15,23,42,.09)}
.insight summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:11px;padding:13px 16px;user-select:none;background:linear-gradient(180deg,#fff,#f7fbf8);transition:.15s}
.insight summary::-webkit-details-marker{display:none}
.insight summary:hover{background:linear-gradient(180deg,#f3fbf6,#eaf7f0)}
.insight summary:focus-visible{outline:2px solid #16a34a;outline-offset:-2px}
.insight[open] summary{background:#f8fafc}
.sum-ico{flex-shrink:0;width:28px;height:28px;border-radius:9px;background:#ecfdf5;border:1px solid #bbf7d0;display:inline-flex;align-items:center;justify-content:center;font-size:15px}
.sum-main{font-size:13.5px;font-weight:800;color:#123a29;flex:1;line-height:1.55}
.sum-hint{display:none}/* 旧解析文件里的文字提示：按钮已统一，不再显示 */
.sum-btn{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(180deg,#22c55e,#16a34a);color:#fff;font-size:12.5px;font-weight:800;border-radius:999px;padding:6px 15px;flex-shrink:0;box-shadow:0 2px 8px rgba(22,163,74,.35);animation:sumPulse 2.8s ease-in-out infinite}
.insight[open] .sum-btn{background:#94a3b8;box-shadow:none;animation:none}
.sum-btn .t-close{display:none}
.insight[open] .sum-btn .t-open{display:none}
.insight[open] .sum-btn .t-close{display:inline}
.sum-caret{font-size:10px;line-height:1;transition:.2s}
.insight[open] .sum-caret{transform:rotate(180deg)}
@keyframes sumPulse{0%,100%{box-shadow:0 2px 8px rgba(22,163,74,.3)}50%{box-shadow:0 2px 14px rgba(22,163,74,.55)}}
@media (prefers-reduced-motion:reduce){.sum-btn{animation:none}}
.insight-body{padding:0 16px 16px;border-top:1px solid #eef3f8}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.compare .col{border-radius:12px;padding:14px 15px}
.compare .bad{background:#fff8f8;border:1px solid #fecdd3}.compare .good{background:#f6fef9;border:1px solid #bbf7d0}
.compare .col-label{font-size:12px;font-weight:800;display:inline-flex;align-items:center;gap:6px;margin-bottom:9px;border-radius:999px;padding:2px 10px}
.compare .bad .col-label{color:#be123c;background:#ffe4e6}.compare .good .col-label{color:#15803d;background:#dcfce7}
.compare p{font-size:13px;line-height:1.85;color:#374151}.compare .good p{color:#14532d}.compare .bad p{color:#7f1d1d}
.compare .why{margin-top:10px;font-size:12px;color:#b91c1c;border-top:1px dashed #fecdd3;padding-top:9px}
.arrow-note{text-align:center;margin:14px 0 0;font-size:12.5px;color:#8b98ab;line-height:1.9}.arrow-note b{color:#be123c}
.closer{background:linear-gradient(180deg,rgba(255,255,255,0) 56%,#bbf7d0 56%);font-weight:800;color:#065f46;padding:0 3px;border-radius:3px}${sysCss}
.tips{list-style:none;margin-top:12px;display:grid;gap:8px}
.tips li{display:flex;gap:12px;padding:11px 13px;border:1px solid #eef3f8;border-radius:12px;font-size:13.5px;line-height:1.8;background:#fcfdfe}
.tips .num{min-width:22px;height:22px;border-radius:8px;background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:3px;box-shadow:0 2px 6px rgba(37,99,235,.25)}
.tips b{color:#0f172a}
.footer{text-align:center;font-size:11px;color:#9ba8ba;margin-top:26px;line-height:1.9}
@media print{.insight:not([open]){display:block}.insight summary{display:none}}
@media (max-width:720px){.wrap{max-width:100%;padding:14px 10px 44px}.card{padding:14px}.chat-area{padding:12px}.compare{grid-template-columns:1fr}.msg-body{max-width:90%}.sum-btn{font-size:11.5px;padding:5px 12px}.sum-main{font-size:12.5px}}
</style>
</head>
<body>
<div class="wrap">
<div class="card">
  <div class="hint"><span class="hint-ico">💡</span><span class="hint-txt">真实会话回放。${sysHint}每条“◆ 可优化回复”下方都有<b>就地解析</b>：点右侧绿色<b>「点击展开解析」</b>按钮，看“当时怎么说 vs 建议怎么说”，重点话术用绿底标出。</span></div>
  <div class="chat-area">
    <div class="session-title">
      <span><span class="st-dot"></span>💬 ${esc(review.window || chat.meta.window || '')} · <span class="cid">${esc(customerLabel)}</span> 会话</span>
      ${customerLabel ? '<button class="cid-toggle" onclick="document.body.classList.toggle(\'show-cid\')">👁 客户ID</button>' : ''}
    </div>
    ${chatArea}
  </div>
</div>
<div class="footer">本演示由真实对话记录生成（来源：${esc(store || '客服后台')}，客服已脱敏）｜仅供内部培训使用</div>
</div>
</body>
</html>`;

  return {
    html,
    report: {
      messageCount: chat.messages.length,
      insightCount: Object.keys(review.insights || {}).length,
      systemCount: chat.messages.filter((m) => m.role === 'system').length,
      imageFailures,
      monthDir: monthDirOf(review.window || chat.meta.window)
    }
  };
}

module.exports = { renderCourseware, esc };
