// 课件 HTML 渲染（纯业务）：标准聊天记录 + 解析文件 → 单文件 HTML
// 样式沿用已验证的"就地解析"模板（make_chat_demo.js）：无目录、无结尾总结卡、
// 客服蓝右/客户白左、<details> 就地内嵌、图片内嵌、客户ID 默认脱敏+眼睛按钮。
const { monthDirOf } = require('./paths');

/** HTML 转义；再把转义后的 <br/> 还原为真实换行标签 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/&lt;br\/&gt;/gi, '<br/>');
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
  const noteBadge = overlay && overlay.note ? `<div class="note-mark">${esc(overlay.note)}</div>` : '';
  const badBadge = overlay && overlay.bad ? `<div class="key-mark"><span class="key-flag">◆ 可优化回复</span></div>` : '';
  let bubble;
  if (msg.img && imgMap[msg.img]) {
    const data = imgMap[msg.img].data;
    bubble = `<div class="bubble bubble-img">${esc(msg.text)}<img src="${data}" alt="图片" onclick="this.classList.toggle('zoom')"/></div>`;
  } else {
    bubble = `<div class="bubble">${esc(msg.text)}</div>`;
  }
  let html = `<div class="msg ${isCus ? 'from-cus' : 'from-kf'}">
    <div class="msg-body">
      <div class="msg-meta"><span class="who">${isCus ? '客户' : '客服'}</span><span class="time">${esc((msg.time || '').slice(11, 16))}</span>${noteBadge}</div>
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
    const insightHtml = overlay && overlay.insight ? review.insights[overlay.insight] : null;
    return renderMessage(msg, overlay, insightHtml, imgMap);
  }).join('');

  const customerLabel = chat.meta.customer || chat.meta.orderId || '';
  const title = review.title || `${chat.meta.customer || chat.meta.window || '客服'} 培训案例`;
  const sub = review.sub || '';
  const tagline = review.tagline || '客服培训';
  const store = review.store || chat.meta.store || '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>培训课件：${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;background:#eef0f3;color:#2d3436;line-height:1.7;font-size:14px}
.wrap{max-width:980px;margin:0 auto;padding:20px 16px 60px}
.header{background:linear-gradient(135deg,#b91c1c,#e1251b,#ff5a3c);color:#fff;border-radius:14px;padding:22px 26px;margin-bottom:18px}
.header .tagline{display:inline-block;background:rgba(255,255,255,.22);border-radius:20px;padding:2px 14px;font-size:12px;margin-bottom:10px}
.header h1{font-size:22px;font-weight:800;margin-bottom:10px;letter-spacing:.5px}
.header .sub{font-size:13px;opacity:.95;line-height:1.9}.header .sub b{font-weight:700}
.card{background:#fff;border-radius:14px;padding:20px 22px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.card .hint{font-size:12.5px;color:#64748b;margin-bottom:14px}
.chat-area{background:#f8f9fb;border:1px solid #eef0f3;border-radius:12px;padding:18px}
.session-title{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:800;color:#e1251b;background:#fff1f0;border:1px solid #ffd9d6;border-radius:8px;padding:6px 12px;margin-bottom:14px}
.cid{display:none}
body.show-cid .cid{display:inline}
.cid-toggle{background:none;border:1px solid #ffc7c3;border-radius:16px;color:#b91c1c;font-size:12px;padding:2px 12px;cursor:pointer;font-weight:700}
.msg{display:flex;margin-bottom:8px}.msg-body{max-width:78%}
.from-cus{justify-content:flex-start;margin-right:auto}.from-kf{justify-content:flex-end;margin-left:auto}
.msg-meta{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#8a94a6;margin-bottom:4px;flex-wrap:wrap}
.from-kf .msg-meta{flex-direction:row-reverse}.msg-meta .who{color:#475569;font-weight:700}
.note-mark{font-size:10.5px;background:#fde68a;color:#92400e;border-radius:10px;padding:1px 9px}
.bubble{padding:10px 14px;border-radius:12px;font-size:14px;word-break:break-word;line-height:1.75}
.from-cus .bubble{background:#fff;border:1px solid #e2e8f0;border-top-left-radius:3px}
.from-kf .bubble{background:#3b82f6;color:#fff;border-top-right-radius:3px}
.bubble-img img{display:block;max-width:260px;margin-top:8px;border-radius:8px;cursor:zoom-in;border:1px solid rgba(255,255,255,.4)}
.bubble-img img.zoom{max-width:100%}
.key-mark{margin-top:6px;display:flex;justify-content:flex-start}.key-flag{background:#e1251b;color:#fff;font-size:11px;font-weight:800;border-radius:6px;padding:2px 10px}
.insight{margin:12px 0 16px;border-radius:12px;overflow:hidden}
.speech-insight{background:#fffaf3;border:1px solid #fde0a8}
.insight summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:11px 14px;user-select:none;transition:.15s}
.insight summary::-webkit-details-marker{display:none}
.speech-insight summary:hover{background:#fff3d9}
.sum-ico{font-size:15px}.sum-main{font-size:13px;font-weight:800;color:#b45309;flex:1;line-height:1.5}
.sum-hint{font-size:11px;color:#94a3b8;background:#f1f5f9;border-radius:10px;padding:2px 10px;flex-shrink:0}
.insight summary::after{content:'▾';color:#94a3b8;font-size:13px;transition:.2s}
.insight[open] summary::after{transform:rotate(180deg)}
.insight-body{padding:0 14px 14px;border-top:1px dashed #e2e8f0}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.compare .col{border-radius:12px;padding:14px 15px}
.compare .bad{background:#fef5f5;border:1px solid #fecaca}.compare .good{background:#f0fdf4;border:1px solid #bbf7d0}
.compare .col-label{font-size:12px;font-weight:800;display:flex;align-items:center;gap:6px;margin-bottom:8px}
.compare .bad .col-label{color:#b91c1c}.compare .good .col-label{color:#15803d}
.compare p{font-size:13px;line-height:1.82;color:#374151}.compare .good p{color:#14532d}.compare .bad p{color:#7f1d1d}
.compare .why{margin-top:8px;font-size:12px;color:#b91c1c;border-top:1px dashed #fecaca;padding-top:8px}
.arrow-note{text-align:center;margin:12px 0 0;font-size:12.5px;color:#94a3b8;line-height:1.8}.arrow-note b{color:#e1251b}
.tips{list-style:none;margin-top:10px}
.tips li{display:flex;gap:12px;padding:10px 0;border-bottom:1px dashed #e5e7eb;font-size:13.5px;line-height:1.8}
.tips .num{min-width:21px;height:21px;border-radius:50%;background:#1d4ed8;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:3px}
.tips b{color:#1e293b}
.footer{text-align:center;font-size:11px;color:#a0aab8;margin-top:22px;line-height:1.8}
@media print{.insight:not([open]){display:block}.insight summary{display:none}}
@media (max-width:720px){.wrap{max-width:100%;padding:14px 10px 40px}.card{padding:14px}.chat-area{padding:12px}.compare{grid-template-columns:1fr}.msg-body{max-width:90%}.sum-hint{display:none}}
</style>
</head>
<body>
<div class="wrap">
<div class="header">
  <div class="tagline">${esc(tagline)}</div>
  <h1>${esc(title)}</h1>
  <div class="sub">${sub}</div>
</div>
<div class="card">
  <div class="hint">👇 真实会话回放。每条“◆ 可优化回复”下方都有<b>就地解析</b>，点击展开看“当时怎么说 vs 建议怎么说”。</div>
  <div class="chat-area">
    <div class="session-title">
      <span>💬 ${esc(review.window || chat.meta.window || '')} · <span class="cid">${esc(customerLabel)}</span> 会话</span>
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
      imageFailures,
      monthDir: monthDirOf(review.window || chat.meta.window)
    }
  };
}

module.exports = { renderCourseware, esc };
