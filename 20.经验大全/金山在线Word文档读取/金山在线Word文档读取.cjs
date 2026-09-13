#!/usr/bin/env node
/**
 * 金山/WPS 在线文档无GUI读取（大纲文档 otl）
 *
 * 配套笔记：同目录《金山在线Word文档读取经验.md》
 *
 * 只读工具：不写入任何在线文档；登录态只存在于本机浏览器画像中，
 * 不导出、不打印 Cookie 和请求头，也不默认保存 session 响应（其中含临时 token）。
 *
 * 用法：
 *   $env:NODE_PATH = "D:\桌面\办公软件\1.客服超时督办\node_modules"
 *   node .\金山在线Word文档读取.cjs --share-id 分享ID --profile C:/Users/b3460/.pi-edge-auto --out 输出目录
 *
 * 参数：
 *   --share-id  必填，https://www.kdocs.cn/l/{shareId} 里的 shareId
 *   --profile   必填，已登录金山的浏览器画像目录
 *   --out       选填，输出目录，默认当前目录
 *   --wait      选填，页面加载后等待毫秒数，默认 15000
 *   --browser   选填，浏览器 channel，默认 msedge
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    out[k.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args['share-id'] || !args.profile) {
  console.error('缺少参数。示例：node 金山在线Word文档读取.cjs --share-id 分享ID --profile C:/Users/你/.pi-edge-auto');
  process.exit(2);
}

const SHARE_ID = args['share-id'];
const OUT_DIR = path.resolve(args.out || '.');
const WAIT_MS = Number(args.wait || 15000);
const CHANNEL = args.browser || 'msedge';

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  console.error('找不到 playwright-core。请设置 NODE_PATH 指向已有依赖，例如：');
  console.error('  $env:NODE_PATH = "D:\\桌面\\办公软件\\1.客服超时督办\\node_modules"');
  process.exit(2);
}

// 按文档块原始顺序取正文，保留“标题—段落—图片”的对应关系
function extractBlocks(root) {
  const lines = [];
  const pics = [];
  let textNodes = 0;
  let headings = 0;

  function flush(node) {
    const parts = [];
    (function walk(n) {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (n.type === 'text' && typeof n.text === 'string') {
        textNodes++;
        parts.push(n.text);
      }
      if (n.type === 'picture' && n.attrs && n.attrs.sourceKey) {
        pics.push({ key: n.attrs.sourceKey, w: n.attrs.oriWidth, h: n.attrs.oriHeight });
      }
      if (Array.isArray(n.content)) n.content.forEach(walk);
    })(node);
    return parts.join('');
  }

  (function walkBlocks(node) {
    if (Array.isArray(node)) return node.forEach(walkBlocks);
    if (!node || typeof node !== 'object') return;
    const t = node.type;
    if (t === 'picture') {
      flush(node);
      lines.push('[图片]');
      return;
    }
    if (t === 'heading' || t === 'paragraph' || t === 'outline-title') {
      const s = flush(node).trim();
      if (s) {
        if (t === 'paragraph') lines.push(s);
        else {
          headings++;
          lines.push(`# ${s}`);
        }
      }
      return;
    }
    if (Array.isArray(node.content)) node.content.forEach(walkBlocks);
  })(root);

  return { lines, pics, textNodes, headings };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(path.resolve(args.profile), {
    channel: CHANNEL,
    headless: true,
    viewport: { width: 1440, height: 1000 },
  });

  const page = ctx.pages()[0] || (await ctx.newPage());
  const captured = [];
  const pending = [];

  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/open/otl')) return;
    captured.push({ status: response.status(), url });
    pending.push(
      (async () => {
        try {
          const body = await response.body();
          fs.writeFileSync(path.join(OUT_DIR, 'kdocs-open-otl.json'), body);
        } catch (e) {
          captured.push({ status: 'BODY_FAIL', url: String(e && e.message) });
        }
      })(),
    );
  });

  await page.goto(`https://www.kdocs.cn/l/${SHARE_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(WAIT_MS);
  await Promise.all(pending);

  const title = await page.title();
  const finalUrl = page.url();
  const otlPath = path.join(OUT_DIR, 'kdocs-open-otl.json');

  const report = { 标题: title, 最终地址: finalUrl, 接口: captured };
  const lines = [];

  if (!fs.existsSync(otlPath)) {
    lines.push('未捕获到 open/otl 响应：通常是尚未登录或没有访问权限。');
    lines.push('不要猜正文；先让主管在授权环境完成登录，再重跑。');
  } else {
    const raw = fs.readFileSync(otlPath, 'utf8');
    report['open/otl字节数'] = Buffer.byteLength(raw);

    let json = null;
    try {
      json = JSON.parse(raw);
      report['JSON可解析'] = true;
    } catch (e) {
      report['JSON可解析'] = false;
      report['解析错误'] = String(e && e.message);
    }

    if (json && json.content && Array.isArray(json.content.content)) {
      const { lines: bodyLines, pics, textNodes, headings } = extractBlocks(json.content.content);
      fs.writeFileSync(path.join(OUT_DIR, 'online-text.txt'), bodyLines.join('\n'), 'utf8');
      fs.writeFileSync(path.join(OUT_DIR, 'online-pics.json'), JSON.stringify(pics, null, 2), 'utf8');

      report['章节数'] = headings;
      report['段落行数'] = bodyLines.length;
      report['文字节点数'] = textNodes;
      report['图片节点数'] = pics.length;

      const heads = bodyLines.filter((l) => l.startsWith('# '));
      report['首章'] = heads[0] || '';
      report['末章'] = heads[heads.length - 1] || '';

      lines.push('验收：把上面 5 个数（章节/段落/文字节点/图片节点/首末章）和页面显示、本地导出副本比对。');
      lines.push('结论只以在线版为准；本地 docx/pdf 副本只可用于快速预览。');
      if (pics.length) {
        lines.push(`有 ${pics.length} 张图片节点，正文里只留 [图片] 占位，关键信息可能全在截图里，需按第四步换取签名地址后下载核对。`);
      }
    } else {
      lines.push('open/otl 内容结构与预期不同：不要硬解析，先按笔记第一步重新确认页面类型和接口形状。');
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'online-report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  lines.forEach((l) => console.log('- ' + l));

  await ctx.close();
})();
