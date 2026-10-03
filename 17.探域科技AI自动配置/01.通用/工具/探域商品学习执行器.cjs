// 意图：对探域「商品学习」做**多店**受控写入（学习 / 禁用学习），默认 dry-run，只有 --commit 才 POST。
// 来源：由 C3 单店执行器（2026-10-01，DEDAKJ 写死）泛化；接口形状已由前端 bundle + UI 拦截空跑核对。
// 接口（均已核对）：
//   学习 POST /api/copilot/product-learning/config/save-learn-product   body {bindProductList:[{spuId,thirdShopId}]}
//   禁用 POST /api/copilot/product-learning/config/save-un-learn-product body {bindProductList:[{spuId,thirdShopId}]}
//   读   GET  /api/copilot/product-learning/config/page?pageIndex=1&pageSize=100
//   读   POST /api/kbe/v1/knowledge-product/product-paginate {pageIndex:1,pageSize:N,needDetail:false,thirdShopIds:[...]}
//   读积分 GET /api/gc/subscription-order/points/usage-status
// 验证：写前重读（目标必须「未在学习名单」且状态未禁止）；写完逐店回读 learningSpuList / learningProductCount / agentShopLearnStatus。
// 成本：学习 10 积分/个且**不可退**；dry-run 先打印「将学清单 + 预计积分」，确认后再 --commit。
// 恢复：禁用可用「添加AI商品学习」恢复；学习不可退。失败不做任何自动重试（读回读最多 3 轮，不重复写）。
//
// 用法：
//   node 探域商品学习执行器.cjs --base-url "https://agent.tanyuai.com" --profile "<登录画像>" \
//     --playwright-core-path "<playwright-core>" --browser-channel msedge \
//     --targets "目标清单.json" [--mode learn|unlearn] [--commit] [--out-dir "<证据目录>"] [--allow-offsale]
//
// 目标清单格式（两种都收）：
//   { "stores": [ { "thirdShopId": "...", "shopName": "可选", "spuIds": ["..."] } ] }
//   或平铺 [ { "thirdShopId": "...", "spuId": "..." }, ... ]
// 缺省行为：学模式下跳过 onSale=false（用 --allow-offsale 关闭该跳过的默认）；跳过已在学（状态2/名单里）与禁止学习（状态3）。
'use strict';
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

async function 页面内请求(page, endpoint, method, body) {
  return page.evaluate(async ({ endpoint, method, body }) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(endpoint, {
        method, credentials: 'include', signal: ctl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      let json = null; try { json = await r.json(); } catch { /* 非 JSON */ }
      return { httpStatus: r.status, json };
    } finally { clearTimeout(timer); }
  }, { endpoint, method, body });
}

async function 读配置(page) {
  const r = await 页面内请求(page, '/api/copilot/product-learning/config/page?pageIndex=1&pageSize=100', 'GET');
  if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`读商品学习配置失败 http=${r.httpStatus} code=${r.json?.code}`);
  return r.json.data.results || [];
}
async function 读商品(page, thirdShopIds) {
  const r = await 页面内请求(page, '/api/kbe/v1/knowledge-product/product-paginate', 'POST',
    { pageIndex: 1, pageSize: 4000, needDetail: false, thirdShopIds: thirdShopIds.map(String) });
  if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`读商品清单失败 http=${r.httpStatus} code=${r.json?.code}`);
  const d = r.json.data || {};
  const 行 = d.results || [];
  if (Number.isFinite(Number(d.total)) && 行.length !== Number(d.total)) {
    throw new Error(`商品清单拉取不全（fail-closed）：results=${行.length} total=${d.total}，请调大 pageSize 重来`);
  }
  return 行;
}
async function 读积分(page) {
  const r = await 页面内请求(page, '/api/gc/subscription-order/points/usage-status', 'GET');
  return r.json?.data || null;
}
function 取店配置(配置, thirdShopId) {
  const 店 = 配置.find(x => String(x.thirdShopId) === String(thirdShopId));
  if (!店) throw new Error(`商品学习配置里没有店 ${thirdShopId}`);
  return 店;
}

/** 目标清单 → [{thirdShopId, spuId}]（去重、保序） */
function 解析目标(原始) {
  const 平铺 = [];
  if (Array.isArray(原始)) {
    for (const x of 原始) 平铺.push({ thirdShopId: String(x.thirdShopId), spuId: String(x.spuId) });
  } else if (原始 && Array.isArray(原始.stores)) {
    for (const s of 原始.stores) for (const spu of s.spuIds || []) 平铺.push({ thirdShopId: String(s.thirdShopId), spuId: String(spu) });
  } else throw new Error('目标清单格式不对：需要 {stores:[{thirdShopId,spuIds:[]}]} 或 [{thirdShopId,spuId}]');
  const 去重 = new Map();
  for (const x of 平铺) {
    if (!x.thirdShopId || !x.spuId) throw new Error(`目标项缺字段：${JSON.stringify(x)}`);
    去重.set(`${x.thirdShopId}_${x.spuId}`, x);
  }
  return [...去重.values()];
}

async function main() {
  const baseUrl = required('--base-url').replace(/\/$/, '');
  const profile = required('--profile');
  const 清单文件 = path.resolve(required('--targets'));
  const 模式 = (argument('--mode', 'learn') || '').toLowerCase();
  if (!['learn', 'unlearn'].includes(模式)) throw new Error('--mode 只能是 learn 或 unlearn');
  const 允许下架 = process.argv.includes('--allow-offsale');
  const 提交 = process.argv.includes('--commit');
  const outDir = argument('--out-dir', process.cwd());
  fs.mkdirSync(outDir, { recursive: true });
  const 动作 = 模式 === 'learn' ? '学习' : '禁用';

  const 目标 = 解析目标(JSON.parse(fs.readFileSync(清单文件, 'utf8')));
  const 目标店 = [...new Set(目标.map(x => x.thirdShopId))];
  console.log(`动作=${动作} 目标数=${目标.length} 涉及店=${目标店.length}`);

  const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || argument('--playwright-core-path') || 'playwright-core');
  const 启动 = { headless: true };
  const 频道 = argument('--browser-channel');
  if (频道) 启动.channel = 频道;
  const context = await chromium.launchPersistentContext(path.resolve(profile), 启动);
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // 1) 写前重读
    const 配置前 = await 读配置(page);
    const 商品前 = await 读商品(page, 目标店);
    const 积分前 = await 读积分(page);
    const 店配置前 = new Map(目标店.map(id => [id, 取店配置(配置前, id)]));
    const 商品表 = new Map(商品前.map(x => [`${x.thirdShopId}_${x.spuId}`, x]));
    const 在学前 = new Map(目标店.map(id => [id, new Set((店配置前.get(id).learningSpuList || []).map(String))]));
    const 禁用前 = new Map(目标店.map(id => [id, new Set((店配置前.get(id).unLearningSpuList || []).map(String))]));

    const 实做 = [];
    const 跳过 = [];
    for (const x of 目标) {
      const 商品 = 商品表.get(`${x.thirdShopId}_${x.spuId}`);
      if (!商品) { 跳过.push({ ...x, 原因: '商品清单里没有' }); continue; }
      if (模式 === 'learn') {
        if (在学前.get(x.thirdShopId).has(x.spuId) || 商品.agentShopLearnStatus === 2) { 跳过.push({ ...x, 原因: '已在学习名单/学习中（不重复学）' }); continue; }
        if (商品.agentShopLearnStatus === 3) { 跳过.push({ ...x, 原因: '已是禁止学习状态' }); continue; }
        if (!允许下架 && 商品.onSale === false) { 跳过.push({ ...x, 原因: '已下架（默认不学，--allow-offsale 可关掉该跳过）', 标题: 商品.title }); continue; }
      } else {
        if (禁用前.get(x.thirdShopId).has(x.spuId) || 商品.agentShopLearnStatus === 3) { 跳过.push({ ...x, 原因: '已禁止学习（不重复禁用）' }); continue; }
      }
      实做.push({ spuId: x.spuId, thirdShopId: x.thirdShopId, 标题: 商品.title, 上架: 商品.onSale, 状态前: 商品.agentShopLearnStatus });
    }
    const 按店 = new Map();
    for (const x of 实做) { if (!按店.has(x.thirdShopId)) 按店.set(x.thirdShopId, []); 按店.get(x.thirdShopId).push(x); }

    console.log(`实做数=${实做.length}（跳过 ${跳过.length}）`);
    for (const [id, 行] of 按店) console.log(`  · 店 ${id}：${行.length} 个（学习成本约 ${模式 === 'learn' ? 行.length * 10 : 0} 积分）`);
    if (模式 === 'learn') console.log(`预计学习成本合计=${实做.length * 10} 积分（不可退）；写前余额=${积分前?.availableBalance}`);
    for (const s of 跳过) console.log(`  跳过 ${s.thirdShopId}_${s.spuId}：${s.原因} ${s.标题 ? '｜' + String(s.标题).slice(0, 24) : ''}`);

    const 计划 = {
      动作, 时间: new Date().toISOString(), 清单文件,
      目标数: 目标.length, 实做, 跳过,
      店汇总: [...按店.entries()].map(([thirdShopId, 行]) => ({ thirdShopId, 数量: 行.length, 预计积分: 模式 === 'learn' ? 行.length * 10 : 0 })),
      写前: {
        积分: 积分前?.availableBalance,
        店: [...店配置前.entries()].map(([id, c]) => ({ thirdShopId: id, learningProductCount: c.learningProductCount, 学习名单数: (c.learningSpuList || []).length, 禁用名单数: (c.unLearningSpuList || []).length }))
      }
    };
    const 计划文件 = path.join(outDir, `plan-${动作}-${Date.now()}.json`);
    fs.writeFileSync(计划文件, JSON.stringify(计划, null, 1));
    console.log('计划证据：', 计划文件);
    if (!实做.length) { console.log('没有需要执行的项，退出。'); return; }
    if (!提交) {
      console.log('[dry-run] 未写入。核对清单与积分后加 --commit 重跑。');
      return;
    }

    // 2) 逐店保存（小步）
    const 接口 = 模式 === 'learn' ? '/api/copilot/product-learning/config/save-learn-product' : '/api/copilot/product-learning/config/save-un-learn-product';
    const 保存记录 = [];
    for (const [thirdShopId, 行] of 按店) {
      const 载荷 = { bindProductList: 行.map(x => ({ spuId: x.spuId, thirdShopId: x.thirdShopId })) };
      const 保存 = await 页面内请求(page, 接口, 'POST', 载荷);
      const 成功 = 保存.httpStatus === 200 && 保存.json?.code === 1 && 保存.json?.success === true;
      console.log(`保存 店=${thirdShopId} 个数=${行.length}：http=${保存.httpStatus} code=${保存.json?.code} success=${保存.json?.success} msg=${保存.json?.msg || 保存.json?.message}`);
      保存记录.push({ thirdShopId, 载荷, 响应: 保存 });
      fs.writeFileSync(path.join(outDir, `save-response-${动作}-${thirdShopId}-${Date.now()}.json`), JSON.stringify({ 接口, 载荷, 响应: 保存 }, null, 1));
      if (!成功) throw new Error(`店 ${thirdShopId} 保存响应不是业务成功，停止（不自动重试）`);
    }

    // 3) 回读（最多 3 轮，只读，不重复写）
    let 配置后 = null; let 商品后 = null; let 积分后 = null;
    for (let 轮 = 1; 轮 <= 3; 轮++) {
      await page.waitForTimeout(轮 === 1 ? 2500 : 5000);
      配置后 = await 读配置(page);
      商品后 = await 读商品(page, 目标店);
      积分后 = await 读积分(page);
      const 商品表后 = new Map(商品后.map(x => [`${x.thirdShopId}_${x.spuId}`, x]));
      const 都到位 = 实做.every(x => {
        const c = 取店配置(配置后, x.thirdShopId);
        const 在学 = new Set((c.learningSpuList || []).map(String));
        const 在禁用 = new Set((c.unLearningSpuList || []).map(String));
        const 商品 = 商品表后.get(`${x.thirdShopId}_${x.spuId}`);
        return 模式 === 'learn' ? (在学.has(x.spuId) || 商品?.agentShopLearnStatus === 2) : (在禁用.has(x.spuId) || 商品?.agentShopLearnStatus === 3);
      });
      if (都到位 || 轮 === 3) break;
      console.log(`回读第 ${轮} 轮未全部到位，再等一轮（只读）…`);
    }

    const 店配置后 = new Map(目标店.map(id => [id, 取店配置(配置后, id)]));
    const 商品表后 = new Map(商品后.map(x => [`${x.thirdShopId}_${x.spuId}`, x]));
    const 逐项 = 实做.map(x => {
      const c = 店配置后.get(x.thirdShopId);
      const 商品 = 商品表后.get(`${x.thirdShopId}_${x.spuId}`);
      return {
        thirdShopId: x.thirdShopId, spuId: x.spuId, 标题: x.标题, 上架: x.上架, 状态前: x.状态前,
        状态后: 商品?.agentShopLearnStatus,
        在学习名单: (c.learningSpuList || []).map(String).includes(x.spuId),
        在禁用名单: (c.unLearningSpuList || []).map(String).includes(x.spuId)
      };
    });
    const 店diff = [...店配置前.entries()].map(([id, 前]) => {
      const 后 = 店配置后.get(id);
      const 前集 = new Set((前.learningSpuList || []).map(String));
      const 后集 = new Set((后.learningSpuList || []).map(String));
      const 新增 = [...后集].filter(x => !前集.has(x));
      const 丢失 = [...前集].filter(x => !后集.has(x));
      return { thirdShopId: id, learningProductCount: `${前.learningProductCount}→${后.learningProductCount}`, 名单数: `${(前.learningSpuList || []).length}→${(后.learningSpuList || []).length}`, 新增数: 新增.length, 丢失数: 丢失.length, 丢失 };
    });

    const 证据 = {
      动作, 时间: new Date().toISOString(), 清单文件, 接口, 保存记录,
      写前: { 积分: 积分前?.availableBalance, 店: [...店配置前.entries()].map(([id, c]) => ({ thirdShopId: id, learningProductCount: c.learningProductCount, 名单数: (c.learningSpuList || []).length, 禁用名单数: (c.unLearningSpuList || []).length })) },
      写后: { 积分: 积分后?.availableBalance, 店: [...店配置后.entries()].map(([id, c]) => ({ thirdShopId: id, learningProductCount: c.learningProductCount, 名单数: (c.learningSpuList || []).length, 禁用名单数: (c.unLearningSpuList || []).length })) },
      店diff, 逐项
    };
    const 证据文件 = path.join(outDir, `after-${动作}-${Date.now()}.json`);
    fs.writeFileSync(证据文件, JSON.stringify(证据, null, 1));
    console.log('回读证据：', 证据文件);
    for (const d of 店diff) console.log(`  · 店 ${d.thirdShopId}：${d.learningProductCount}，名单 ${d.名单数}，新增 ${d.新增数}，丢失 ${d.丢失数}`);
    for (const r of 逐项) console.log(`  · ${r.thirdShopId}_${r.spuId} 状态 ${r.状态前}→${r.状态后} 在学=${r.在学习名单} 在禁用=${r.在禁用名单} ${String(r.标题 || '').slice(0, 20)}`);

    // 4) 断言
    const 未成 = 模式 === 'learn'
      ? 逐项.filter(r => !(r.在学习名单 || r.状态后 === 2))
      : 逐项.filter(r => !(r.在禁用名单 || r.状态后 === 3));
    // learn：名单里原有商品不许丢；unlearn：从学习名单消失是预期，丢的必须恰好等于该店实做数（多丢=误伤、少丢=没禁掉）
    const 丢失异常 = 店diff.filter(d => {
      if (模式 === 'learn') return d.丢失数 > 0;
      const 该店实做 = 实做.filter(x => String(x.thirdShopId) === String(d.thirdShopId)).length;
      return d.丢失数 !== 该店实做 || d.新增数 > 0;
    });
    const 核验未通过 = 未成.length > 0 || 丢失异常.length > 0;
    console.log(`核验计数：实做=${实做.length} 未成=${未成.length} 丢失异常=${丢失异常.length}`);
    if (核验未通过) {
      console.error('⚠ 回读核验未通过：', JSON.stringify({ 未成, 丢失异常 }));
      process.exitCode = 4;
    } else {
      console.log(`✅ ${动作}回读核验通过（${实做.length} 个）`);
    }
  } finally {
    await context.close();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { 解析目标 };
