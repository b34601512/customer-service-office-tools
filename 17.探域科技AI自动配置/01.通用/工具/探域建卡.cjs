// 意图：往探域知识库**新建**一张知识卡（POST /api/kbe/v1/knowledge-card/save），并回读确认。
// 范围：只新建 SHOP 型卡片（绑店铺，includeCondition.shop）；正文与绑定范围由调用者给的 payload 决定。
// 验证：写入后按标题回读全库，确认卡片存在、类型/绑定/正文段落数一致。
// 恢复：新建卡片可在后台删除（删除属破坏性操作，需主管/经理确认；本工具不做删除）。
//
// 用法：
//   node 探域建卡.cjs --payload "建卡载荷.json" --base-url http://agent.tanyuai.com \
//     --profile "登录画像路径" [--browser-channel msedge] [--build "title|店铺id1,店铺id2|正文文件.txt"] [--out 回读结果.json]
//
// 载荷格式（--payload）：
//   { "title": "...", "content": ["段落1", "段落2"], "thirdShopIds": ["2095398963959042048"] }
//   或直接用 --build 从「标题|店铺id列表|正文文件」拼装（正文里用空行分段）。
const fs = require('fs');
const path = require('path');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

const 空条件 = () => ({ spu: [], shop: [], rules: [], productGroupId: [], sellerGroup: [], platform: [] });

/** 构造建卡载荷（纯函数，便于单测）：content 段落自动补 index（探域要求从 1 开始）。 */
function 构造建卡载荷({ title, content, thirdShopIds, ifBelievable = true, ifOpen = true }) {
  const 标题 = String(title || '').trim();
  if (!标题) throw new Error('title 不能为空');
  const 段落 = (Array.isArray(content) ? content : String(content || '').split(/\n\s*\n/)).map(s => String(s).trim()).filter(Boolean);
  if (!段落.length) throw new Error('content 不能为空');
  const 店铺 = (Array.isArray(thirdShopIds) ? thirdShopIds : []).map(String).filter(Boolean);
  if (!店铺.length) throw new Error('thirdShopIds 不能为空（SHOP 卡必须绑店铺）');
  return {
    title: 标题,
    content: 段落.map((text, i) => ({ content: text, index: i + 1 })),
    labels: [],
    ifBelievable: !!ifBelievable,
    ifOpen: !!ifOpen,
    version: 'V2',
    type: 'SHOP',
    includeCondition: { ...空条件(), shop: 店铺.map(id => ({ thirdShopId: id, cids: [] })) },
    excludeCondition: 空条件(),
    orderStatus: ['PRE_SALE']
  };
}

/** 从「标题|店铺id列表|正文文件」拼装载荷（正文按空行分段）。 */
function 从参数拼装({ build, contentFile }) {
  const [title, shops, inline] = String(build || '').split('|');
  const thirdShopIds = String(shops || '').split(',').map(s => s.trim()).filter(Boolean);
  const content = contentFile
    ? fs.readFileSync(contentFile, 'utf8').split(/\n\s*\n/)
    : String(inline || '').split('\\n');
  return 构造建卡载荷({ title, content, thirdShopIds });
}

async function main() {
  const baseUrl = required('--base-url').replace(/\/$/, '');
  const profile = required('--profile');
  const build = argument('--build');
  const payload = build
    ? 从参数拼装({ build, contentFile: argument('--content-file') })
    : JSON.parse(fs.readFileSync(required('--payload'), 'utf8'));
  const 载荷 = payload instanceof Object && payload.content && typeof payload.content[0] === 'string' ? 构造建卡载荷(payload) : payload;

  if (argument('--dry-run')) {
    console.log('[dry-run] 载荷：' + JSON.stringify(载荷, null, 1));
    return;
  }
  const launchOptions = { headless: true };
  const browserChannel = argument('--browser-channel');
  if (browserChannel) launchOptions.channel = browserChannel;
  const playwrightCorePath = process.env.PLAYWRIGHT_CORE_PATH || argument('--playwright-core-path');
  const { chromium } = require(playwrightCorePath || 'playwright-core'); // 懒加载：纯函数单测不需要 playwright
  const context = await chromium.launchPersistentContext(path.resolve(profile), launchOptions);
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const 保存 = await page.evaluate(async (body) => {
      const r = await fetch('/api/kbe/v1/knowledge-card/save', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      let json = null;
      try { json = await r.json(); } catch { /* 非 JSON */ }
      return { httpStatus: r.status, json };
    }, 载荷);
    const 新id = (保存.json && 保存.json.data && (保存.json.data.id || 保存.json.data)) || '';
    console.log(`保存：http=${保存.httpStatus} code=${保存.json && 保存.json.code} ${(保存.json && 保存.json.msg) || ''} 新卡 id=${新id}`);

    const 回读 = await page.evaluate(async () => {
      const r = await fetch('/api/kbe/v1/knowledge-card/page', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNo: 1, pageSize: 3000 })
      });
      return r.json();
    });
    const 列表 = (回读 && 回读.data && (回读.data.results || 回读.data.list)) || [];
    const 命中 = 列表.filter(c => String(c.title || '') === 载荷.title);
    console.log(`回读：全库 ${列表.length} 张，标题命中 ${命中.length} 张`);
    if (命中.length) {
      const c = 命中[命中.length - 1];
      console.log(`  命中卡 id=${c.id} type=${c.type} 正文段数=${(c.content || []).length} 绑店=${((c.includeCondition || {}).shop || []).map(s => s.thirdShopId).join(',')}`);
    }
    const out = argument('--out');
    if (out) fs.writeFileSync(out, JSON.stringify({ 载荷, 保存: 保存.json, 回读命中: 命中 }, null, 1));
    if (!命中.length) {
      // 探域列表接口有可见延迟（实测新建后 ~10 分钟才出现在 knowledge-card/page），回读不到不等于写入失败。
      console.error('提示：回读未命中不代表失败——探域卡列表有 ~10 分钟延迟；保存返回 code=1/操作成功 时请过 10 分钟再回读确认，且先确认没有重复建卡。');
      process.exitCode = 1;
    }
  } finally {
    await context.close();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { 构造建卡载荷, 从参数拼装 };
