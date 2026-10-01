// 探域知识卡巡检（只读）
// 意图：一次全库读取 + 本地判定，产出五类**候选**：引流词 / 重复卡 / 停用卡 / 绑店错位 / 过期时间词。
// 范围：只调用探域知识卡的全量列表读取接口（POST /api/kbe/v1/knowledge-card/page），不调用任何写接口。
// 读写级别：**只读**（无写动作、无配置改动、无删除）。
// 验证：拉取不全（results < total）立即报错退出（fail-closed，退出码 2）；同输入同输出（不含运行时间戳）。
// 恢复边界：本脚本不产生任何平台副作用，删掉脚本即恢复原状。
//
// 用法（在线）：
//   node 探域知识卡巡检.cjs --base-url http://agent.tanyuai.com --profile "<已登录浏览器画像>" \
//     --browser-channel msedge --playwright-core-path "<playwright-core 路径>" --输出 "<目录>"
// 用法（离线，用已保存的全库响应，便于复跑/对照）：
//   node 探域知识卡巡检.cjs --输入 "<全库.json>" --输出 "<目录>"
// 输出：<目录>/巡检-汇总.json + 五类候选 md（引流词/重复卡/停用卡/绑店错位/过期时间词）
//
// 口径说明：本脚本是「候选扫描器」，不代替人工判定；历史批次（A1/A5/B1/C1/D1）的人工核对数字见任务回执。
// 词表与阈值都在下方常量区，改口径只改常量。

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────── 常量区（口径） ───────────────────────────

// 引流词（A1 口径：正向引流才要改，反向劝阻/业务信息不算）
const 引流词表 = ['二维码', '微信', '微信号', '加微信', '加我', '私聊', 'QQ', '站外', '公众号', '扫码', '微店', '联系方式', '手机号', '电话'];
// 命中文段里出现这些词 → 提示「可能是反向劝阻句」，人工优先按误报看
const 反向劝阻线索 = ['无需', '不要', '不需', '不用', '不得', '切勿', '勿', '严禁', '禁止', '不要求', '不能要求', '不会要求', '承诺不', '不接受'];
// 上下文截取长度（命中词前后）
const 上下文窗口 = 20;

// 重复卡阈值（B1 口径：同文 + 正文相似度 ≥ 95%）
const 相似度阈值 = 0.95;
const 分片长度 = 4; // 4-gram
const 最小哈希数 = 64;
const 分带数 = 8;
const 长度差比例上限 = 0.35; // 近似比较前的长度预筛（放宽）

// 停用卡
const 停用判定 = (card) => card.ifOpen === false;

// 绑店错位（D1 口径：标题/正文品牌 ≠ 绑店品牌）
const 店铺品牌表 = {
  '2104457457798483968': { 名: 'DEDAKJ医疗器械官方旗舰店', 品牌: ['DEDAKJ', '德迩杰'] },
  '2095398963959042048': { 名: '德达医疗旗舰店', 品牌: ['德达'] },
  '2748947711641649387': { 名: 'dedakj旗舰店', 品牌: ['DEDAKJ', '德迩杰'] },
  '2748946698029269223': { 名: 'DEDAKJ医疗器械旗舰店', 品牌: ['DEDAKJ', '德迩杰'] },
  '2748945753136365819': { 名: '德达医疗康养器械旗舰店', 品牌: ['德达'] },
  '2748944481825915146': { 名: 'DEDAKJ官方旗舰店', 品牌: ['DEDAKJ', '德迩杰'] },
  '2748943863350558955': { 名: '德迩杰官方旗舰店', 品牌: ['DEDAKJ', '德迩杰'] },
};
const DEDAKJ店 = '2104457457798483968';
const 德达店 = '2095398963959042048';

// 过期时间词（A5 口径：活动/日期/时效词；命中只出候选，是否过期由人工按上下文判）
const 过期词表 = [
  { 组: '活动', 正则: /活动/g },
  { 组: '限时', 正则: /限时/g },
  { 组: '限量', 正则: /限量|限购|售完即止/g },
  { 组: '节日', 正则: /春节|元旦|国庆|中秋|端午|清明|劳动节|七夕|双11|11\.11|双十一|618/g },
  { 组: '截止', 正则: /截止|截至/g },
  { 组: '有效期', 正则: /有效期|长期有效|全年/g },
  { 组: '到期过期', 正则: /到期|过期|失效/g },
  { 组: '年月日', 正则: /20\d{2}[年\-\/.]\d{1,2}[月\-\/.]\d{1,2}[日号]?/g },
  { 组: '年份', 正则: /20\d{2}年/g },
  { 组: '月日', 正则: /\d{1,2}月\d{1,2}[日号]/g },
  { 组: '节假日', 正则: /工作日|节假日|双休|周末/g },
];
// 疑似已过期：完整日期（年-月-日）早于判定基准日；或「有效期至 <过去日期>」
const 完整日期正则 = /(20\d{2})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})[日号]?/g;

// ─────────────────────────── 基础工具 ───────────────────────────

const 参数 = (名, 缺省) => {
  const i = process.argv.indexOf(名);
  return i >= 0 ? process.argv[i + 1] : 缺省;
};

function 正文全文(card) {
  return (card.content || []).map((c) => (typeof c === 'string' ? c : (c && c.content) || '')).join('\n');
}

function 归一化文本(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function 归一化正文(card) {
  return 正文全文(card)
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

function 取标题(card) {
  return card.title == null ? '' : String(card.title);
}

function SHA256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function 绑店列表(card) {
  const 集合 = new Set();
  const inc = card.includeCondition || {};
  for (const s of inc.spu || []) if (s && s.thirdShopId) 集合.add(String(s.thirdShopId));
  for (const s of inc.shop || []) if (s && (s.thirdShopId || s.id)) 集合.add(String(s.thirdShopId || s.id));
  const pc = card.productCondition || {};
  if (pc.thirdShopId) 集合.add(String(pc.thirdShopId));
  return [...集合].sort();
}

function 店名(id) {
  return (店铺品牌表[id] && 店铺品牌表[id].名) || String(id);
}

function 范围签名(card) {
  const 标签 = (card.labels || []).map((x) => String(x)).sort().join('+');
  return `${绑店列表(card).join(',') || '未绑店'}|${标签}|${card.type || ''}`;
}

function 摘上下文(文本, 位置, 长度, 词长) {
  const 起 = Math.max(0, 位置 - 上下文窗口);
  const 止 = Math.min(文本.length, 位置 + 词长 + 上下文窗口);
  return (起 > 0 ? '…' : '') + 文本.slice(起, 止).replace(/\n/g, '⏎') + (止 < 文本.length ? '…' : '');
}

function 数字补齐(n) {
  return String(n).padStart(2, '0');
}

function 解析基准日(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function 今天字符串(d = new Date()) {
  return `${d.getFullYear()}-${数字补齐(d.getMonth() + 1)}-${数字补齐(d.getDate())}`;
}

// ─────────────────────────── 类别 1：引流词 ───────────────────────────

function 扫引流词(cards) {
  const items = [];
  for (const card of cards) {
    const 命中 = [];
    const 字段值 = [
      { 字段: 'title', 文本: 取标题(card) },
      { 字段: 'content', 文本: 正文全文(card) },
    ];
    for (const { 字段, 文本 } of 字段值) {
      if (!文本) continue;
      for (const 词 of 引流词表) {
        let 位置 = 文本.indexOf(词);
        while (位置 >= 0) {
          const 上下文 = 摘上下文(文本, 位置, 词.length, 词.length);
          命中.push({ 词, 字段, 上下文 });
          位置 = 文本.indexOf(词, 位置 + 词.length);
        }
      }
    }
    if (!命中.length) continue;
    const 反向 = 命中.some((h) => 反向劝阻线索.some((k) => h.上下文.includes(k)));
    items.push({
      id: card.id,
      标题: 取标题(card),
      开关: card.ifOpen === false ? '停用' : '开启',
      绑店: 绑店列表(card).map(店名).join(' / ') || '未绑店',
      类型: card.type || '',
      命中,
      疑似反向劝阻: 反向,
      人工结论: '',
    });
  }
  return items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// ─────────────────────────── 类别 2：重复卡 ───────────────────────────

const FNV偏移 = 0x811c9dc5;
const FNV素数 = 0x01000193;

function fnv1a32(s) {
  let h = FNV偏移;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV素数) >>> 0;
  }
  return h >>> 0;
}

function 分片集(文本) {
  const t = String(文本 || '').replace(/\s+/g, '');
  if (!t) return new Set();
  if (t.length <= 分片长度) return new Set([t]);
  const 集 = new Set();
  for (let i = 0; i + 分片长度 <= t.length; i++) 集.add(t.slice(i, i + 分片长度));
  return 集;
}

function 最小哈希签名(集) {
  const sig = new Array(最小哈希数).fill(0xffffffff);
  for (const sh of 集) {
    const h = fnv1a32(sh);
    for (let i = 0; i < 最小哈希数; i++) {
      const v = Math.imul(h ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
      if (v < sig[i]) sig[i] = v;
    }
  }
  return sig;
}

function Jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let 小 = a, 大 = b;
  if (a.size > b.size) { 小 = b; 大 = a; }
  let 交 = 0;
  for (const x of 小) if (大.has(x)) 交++;
  const 并 = a.size + b.size - 交;
  return 并 === 0 ? 1 : 交 / 并;
}

function 正文分组(cards) {
  const 组 = new Map();
  for (const card of cards) {
    const 键 = SHA256(归一化正文(card));
    if (!组.has(键)) 组.set(键, []);
    组.get(键).push(card);
  }
  return [...组.entries()]
    .filter(([, 成员]) => 成员.length >= 2)
    .map(([键, 成员]) => {
      const 标题集 = new Set(成员.map((c) => 归一化文本(取标题(c))));
      const 范围集 = new Set(成员.map((c) => 范围签名(c) + '|' + (c.ifOpen === false ? '停用' : '开启')));
      return {
        类型: '同文组',
        正文SHA: 键,
        张数: 成员.length,
        不同标题数: 标题集.size,
        同范围完全重复: 范围集.size === 1,
        卡: 成员.map((c) => ({
          id: c.id,
          标题: 取标题(c),
          开关: c.ifOpen === false ? '停用' : '开启',
          绑店: 绑店列表(c).map(店名).join(' / ') || '未绑店',
          范围签名: 范围签名(c),
          lastUpdatedAt: c.lastUpdatedAt || '',
        })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      };
    })
    .sort((a, b) => String(a.正文SHA).localeCompare(String(b.正文SHA)));
}

function 近似分组(cards) {
  // 先按正文 SHA 去重（完全同文由「同文组」负责），近似组只比较不同正文
  const 代表 = new Map();
  for (const card of cards) {
    const sha = SHA256(归一化正文(card));
    const 现有 = 代表.get(sha);
    if (!现有 || String(card.id) < String(现有.id)) 代表.set(sha, card);
  }
  const 节点 = [];
  for (const card of 代表.values()) {
    const 文本 = 归一化正文(card);
    if (!文本) continue;
    const 集 = 分片集(文本);
    if (!集.size) continue;
    节点.push({ id: card.id, card, 集, sig: 最小哈希签名(集), 长度: 文本.replace(/\s+/g, '').length });
  }
  // 分带找候选对
  const 带桶 = new Map();
  const 对 = new Set();
  for (const n of 节点) {
    for (let b = 0; b < 分带数; b++) {
      const key = `${b}:${n.sig.slice(b * (最小哈希数 / 分带数), (b + 1) * (最小哈希数 / 分带数)).join(',')}`;
      if (!带桶.has(key)) 带桶.set(key, []);
      带桶.get(key).push(n.id);
    }
  }
  const id到节点 = new Map(节点.map((n) => [n.id, n]));
  for (const 桶 of 带桶.values()) {
    if (桶.length < 2) continue;
    for (let i = 0; i < 桶.length; i++) {
      for (let j = i + 1; j < 桶.length; j++) {
        const a = id到节点.get(桶[i]), b = id到节点.get(桶[j]);
        const 长度比 = Math.abs(a.长度 - b.长度) / Math.max(a.长度, b.长度, 1);
        if (长度比 > 长度差比例上限) continue;
        const shaA = SHA256(归一化正文(a.card)), shaB = SHA256(归一化正文(b.card));
        if (shaA === shaB) continue; // 完全同文由「同文组」负责
        const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
        对.add(key);
      }
    }
  }
  // 并查集
  const 父 = new Map();
  const 找 = (x) => { while (父.get(x) !== x) { 父.set(x, 父.get(父.get(x))); x = 父.get(x); } return x; };
  const 并 = (x, y) => { const rx = 找(x), ry = 找(y); if (rx !== ry) 父.set(rx, ry); };
  const 成对相似 = new Map();
  for (const key of 对) {
    const [x, y] = key.split('|');
    const a = id到节点.get(x), b = id到节点.get(y);
    const sim = Jaccard(a.集, b.集);
    if (sim < 相似度阈值) continue;
    if (!父.has(x)) 父.set(x, x);
    if (!父.has(y)) 父.set(y, y);
    并(x, y);
    成对相似.set(key, sim);
  }
  const 组 = new Map();
  for (const x of 父.keys()) {
    const r = 找(x);
    if (!组.has(r)) 组.set(r, []);
    组.get(r).push(x);
  }
  const 结果 = [];
  for (const 成员 of 组.values()) {
    if (成员.length < 2) continue;
    let 最小 = 1;
    for (const key of 成对相似.keys()) {
      const [x, y] = key.split('|');
      if (成员.includes(x) && 成员.includes(y)) 最小 = Math.min(最小, 成对相似.get(key));
    }
    结果.push({
      类型: '近似组',
      最小相似度: Number(最小.toFixed(4)),
      张数: 成员.length,
      卡: 成员.map((id) => {
        const c = id到节点.get(id).card;
        return {
          id,
          标题: 取标题(c),
          开关: c.ifOpen === false ? '停用' : '开启',
          绑店: 绑店列表(c).map(店名).join(' / ') || '未绑店',
          lastUpdatedAt: c.lastUpdatedAt || '',
        };
      }).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    });
  }
  return 结果.sort((a, b) => a.最小相似度 - b.最小相似度 || String(a.卡[0].id).localeCompare(String(b.卡[0].id)));
}

// ─────────────────────────── 类别 3：停用卡 ───────────────────────────

function 扫停用卡(cards) {
  const 开启正文 = new Map();
  for (const c of cards) {
    if (c.ifOpen === false) continue;
    开启正文.set(SHA256(归一化正文(c)), (开启正文.get(SHA256(归一化正文(c))) || 0) + 1);
  }
  return cards
    .filter(停用判定)
    .map((c) => {
      const sha = SHA256(归一化正文(c));
      const 有开启同文 = 开启正文.has(sha);
      return {
        id: c.id,
        标题: 取标题(c),
        绑店: 绑店列表(c).map(店名).join(' / ') || '未绑店',
        类型: c.type || '',
        lastUpdatedAt: c.lastUpdatedAt || '',
        提示: 有开启同文 ? '疑似被开启版取代（存在正文相同的开启卡）' : '待人工判定内容是否仍有效（旧版/过期/内部话术）',
      };
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// ─────────────────────────── 类别 4：绑店错位 ───────────────────────────

function 品牌命中(文本, 品牌) {
  return (品牌 || []).some((b) => String(文本 || '').toUpperCase().includes(String(b).toUpperCase()));
}

function 扫绑店错位(cards) {
  const items = [];
  for (const card of cards) {
    const 店 = 绑店列表(card);
    const 标题 = 取标题(card);
    const 正文 = 正文全文(card);
    const 标题跨品牌 = [];
    const 正文跨品牌 = [];
    if (品牌命中(标题, 店铺品牌表[DEDAKJ店].品牌) && !店.includes(DEDAKJ店)) 标题跨品牌.push('DEDAKJ');
    if (品牌命中(标题, ['德达']) && !店.includes(德达店)) 标题跨品牌.push('德达');
    if (品牌命中(正文, 店铺品牌表[DEDAKJ店].品牌) && !店.includes(DEDAKJ店)) 正文跨品牌.push('DEDAKJ');
    if (品牌命中(正文, ['德达']) && !店.includes(德达店)) 正文跨品牌.push('德达');
    const 未绑店 = 店.length === 0;
    if (!标题跨品牌.length && !正文跨品牌.length && !未绑店) continue;
    const 提示 = [];
    if (标题跨品牌.length) 提示.push('标题品牌与绑店不一致：优先人工核对是否改绑/双店');
    if (正文跨品牌.length) 提示.push('正文品牌与绑店不一致：注意「德达医疗（深圳）有限公司」是厂家/注册人事实，可能是误报');
    if (未绑店) 提示.push('未绑定任何店铺');
    items.push({
      id: card.id,
      标题,
      开关: card.ifOpen === false ? '停用' : '开启',
      绑店: 店.map(店名).join(' / ') || '未绑店',
      类型: card.type || '',
      标题跨品牌,
      正文跨品牌,
      未绑店,
      提示,
    });
  }
  return items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// ─────────────────────────── 类别 5：过期时间词 ───────────────────────────

function 扫过期时间词(cards, 基准日) {
  const items = [];
  for (const card of cards) {
    const 命中 = [];
    const 字段值 = [
      { 字段: 'title', 文本: 取标题(card) },
      { 字段: 'content', 文本: 正文全文(card) },
    ];
    const 过去年份 = new Set();
    let 疑似已过期 = false;
    for (const { 字段, 文本 } of 字段值) {
      if (!文本) continue;
      for (const { 组, 正则 } of 过期词表) {
        const re = new RegExp(正则.source, 'g');
        let m;
        while ((m = re.exec(文本)) !== null) {
          命中.push({ 组, 匹配: m[0], 字段, 上下文: 摘上下文(文本, m.index, m[0].length, m[0].length) });
          if (m[0].length === 0) re.lastIndex++;
        }
      }
      const dateRe = new RegExp(完整日期正则.source, 'g');
      let d;
      while ((d = dateRe.exec(文本)) !== null) {
        const 年 = Number(d[1]);
        if (年 < 1900 || 年 > 2100) continue;
        if (年 < 基准日.getFullYear()) 过去年份.add(d[0]);
        const dt = new Date(年, Number(d[2]) - 1, Number(d[3]));
        if (dt < 基准日) 疑似已过期 = true;
      }
      const 年份Re = /20(\d{2})年/g;
      let y;
      while ((y = 年份Re.exec(文本)) !== null) {
        const 年 = 2000 + Number(y[1]);
        if (年 < 基准日.getFullYear()) 过去年份.add(y[0]);
      }
    }
    if (!命中.length && !过去年份.size) continue;
    items.push({
      id: card.id,
      标题: 取标题(card),
      开关: card.ifOpen === false ? '停用' : '开启',
      绑店: 绑店列表(card).map(店名).join(' / ') || '未绑店',
      类型: card.type || '',
      命中,
      过去年份: [...过去年份].sort(),
      疑似含过去日期: 疑似已过期,
      人工结论: '',
    });
  }
  return items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// ─────────────────────────── 汇总与输出 ───────────────────────────

function 运行巡检({ cards, 数据来源, 判定基准日 }) {
  const 同文组 = 正文分组(cards);
  const 近似组 = 近似分组(cards);
  const 引流 = 扫引流词(cards);
  const 停用 = 扫停用卡(cards);
  const 绑店错位 = 扫绑店错位(cards);
  const 过期 = 扫过期时间词(cards, 判定基准日);
  return {
    meta: {
      口径版本: 'K1-2026-10-02',
      数据来源,
      全库张数: cards.length,
      判定基准日: 今天字符串(判定基准日),
      只读: true,
    },
    类别: {
      引流词: { 候选数: 引流.length, items: 引流 },
      重复卡: {
        同文组数: 同文组.length,
        同文卡数: 同文组.reduce((s, g) => s + g.张数, 0),
        近似组数: 近似组.length,
        items: [...同文组, ...近似组],
      },
      停用卡: { 候选数: 停用.length, items: 停用 },
      绑店错位: { 候选数: 绑店错位.length, items: 绑店错位 },
      过期时间词: { 候选数: 过期.length, items: 过期 },
    },
  };
}

function 渲染md(汇总) {
  const 行 = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, '⏎');
  const 文件 = {};

  {
    const x = 汇总.类别.引流词;
    const L = [`# 引流词候选（只读扫描）`, ``, `- 全库 ${汇总.meta.全库张数} 张，候选 **${x.候选数}** 张（口径：${引流词表.join('/')}）`, `- 提示「疑似反向劝阻」的优先按误报复核；本表不代替人工判定`, ``, `| id | 标题 | 开关 | 绑店 | 命中词 | 字段 | 疑似反向劝阻 | 上下文 |`, `|---|---|---|---|---|---|---|---|`];
    for (const it of x.items) for (const h of it.命中) L.push(`| ${it.id} | ${行(it.标题)} | ${it.开关} | ${行(it.绑店)} | ${行(h.词)} | ${h.字段} | ${it.疑似反向劝阻 ? '是' : ''} | ${行(h.上下文)} |`);
    文件['引流词-候选.md'] = L.join('\n');
  }
  {
    const x = 汇总.类别.重复卡;
    const L = [`# 重复卡候选（只读扫描）`, ``, `- 同文组 **${x.同文组数}** 组 / ${x.同文卡数} 张；近似组（相似度 ≥ ${相似度阈值}，不含同文）**${x.近似组数}** 组`, ``, `## 同文组`, ``, `| 组 | 张数 | 不同标题数 | 同范围完全重复 | id | 标题 | 开关 | 绑店 |`, `|---|---|---|---|---|---|---|---|`];
    let i = 0;
    for (const g of x.items.filter((g) => g.类型 === '同文组')) {
      i++;
      for (const c of g.卡) L.push(`| ${i} | ${g.张数} | ${g.不同标题数} | ${g.同范围完全重复 ? '是' : ''} | ${c.id} | ${行(c.标题)} | ${c.开关} | ${行(c.绑店)} |`);
    }
    L.push(``, `## 近似组`, ``, `| 组 | 最小相似度 | 张数 | id | 标题 | 开关 | 绑店 |`, `|---|---|---|---|---|---|---|`);
    let j = 0;
    for (const g of x.items.filter((g) => g.类型 === '近似组')) {
      j++;
      for (const c of g.卡) L.push(`| ${j} | ${g.最小相似度} | ${g.张数} | ${c.id} | ${行(c.标题)} | ${c.开关} | ${行(c.绑店)} |`);
    }
    文件['重复卡-候选.md'] = L.join('\n');
  }
  {
    const x = 汇总.类别.停用卡;
    const L = [`# 停用卡候选（只读扫描）`, ``, `- 候选 **${x.候选数}** 张（ifOpen=false）`, ``, `| id | 标题 | 绑店 | 类型 | 更新时间 | 提示 |`, `|---|---|---|---|---|---|`];
    for (const it of x.items) L.push(`| ${it.id} | ${行(it.标题)} | ${行(it.绑店)} | ${it.类型} | ${it.lastUpdatedAt} | ${行(it.提示)} |`);
    文件['停用卡-候选.md'] = L.join('\n');
  }
  {
    const x = 汇总.类别.绑店错位;
    const L = [`# 绑店错位候选（只读扫描）`, ``, `- 候选 **${x.候选数}** 张（标题/正文品牌与绑店不一致，或未绑店）`, ``, `| id | 标题 | 绑店 | 标题跨品牌 | 正文跨品牌 | 未绑店 | 提示 |`, `|---|---|---|---|---|---|---|`];
    for (const it of x.items) L.push(`| ${it.id} | ${行(it.标题)} | ${行(it.绑店)} | ${行(it.标题跨品牌.join(','))} | ${行(it.正文跨品牌.join(','))} | ${it.未绑店 ? '是' : ''} | ${行(it.提示.join('；'))} |`);
    文件['绑店错位-候选.md'] = L.join('\n');
  }
  {
    const x = 汇总.类别.过期时间词;
    const L = [`# 过期时间词候选（只读扫描）`, ``, `- 候选 **${x.候选数}** 张（活动/日期/时效词命中；「疑似含过去日期」是提示不是结论）`, ``, `| id | 标题 | 开关 | 绑店 | 疑似含过去日期 | 过去年份 | 命中组 | 上下文 |`, `|---|---|---|---|---|---|---|---|`];
    for (const it of x.items) {
      const 组 = [...new Set(it.命中.map((h) => h.组))].join(',');
      const 上下文 = it.命中.slice(0, 6).map((h) => `${h.匹配}@${h.上下文}`).join(' ｜ ');
      L.push(`| ${it.id} | ${行(it.标题)} | ${it.开关} | ${行(it.绑店)} | ${it.疑似含过去日期 ? '是' : ''} | ${行(it.过去年份.join(','))} | ${行(组)} | ${行(上下文)} |`);
    }
    文件['过期时间词-候选.md'] = L.join('\n');
  }
  return 文件;
}

function 校验全量(响应) {
  if (Array.isArray(响应)) return 响应;
  const 数据 = 响应 && (响应.results ? 响应 : 响应.data && 响应.data.results ? 响应.data : null);
  if (!数据 || !Array.isArray(数据.results)) throw new Error('全库响应格式不对：找不到 results 数组');
  const total = Number(数据.total);
  if (!Number.isFinite(total)) throw new Error('全库响应缺少 total');
  if (数据.results.length !== total) {
    throw new Error(`拉取不全（fail-closed）：results=${数据.results.length} total=${total}。列表接口忽略分页，改用 pageSize>=total 重拉`);
  }
  if (!total) throw new Error('全库 total=0，疑似登录态失效或接口变更，停止');
  return 数据.results;
}

async function 在线拉取({ baseUrl, profile, browserChannel, playwrightCorePath, pageSize }) {
  const { chromium } = require(playwrightCorePath || process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
  const 启动 = { headless: true };
  if (browserChannel) 启动.channel = browserChannel;
  const 上下文 = await chromium.launchPersistentContext(profile, 启动);
  try {
    const page = 上下文.pages()[0] || await 上下文.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const 结果 = await page.evaluate(async (体) => {
      const r = await fetch('/api/kbe/v1/knowledge-card/page', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(体),
      });
      let j = null;
      try { j = await r.json(); } catch { /* 非 JSON */ }
      return { httpStatus: r.status, json: j };
    }, { pageNo: 1, pageSize });
    if (结果.httpStatus !== 200 || !结果.json || 结果.json.code !== 1) {
      throw new Error(`全库读取失败：http=${结果.httpStatus} code=${结果.json && 结果.json.code} msg=${结果.json && 结果.json.msg}`);
    }
    return 结果.json.data;
  } finally {
    await 上下文.close();
  }
}

async function main() {
  const 输出目录 = 参数('--输出') || 参数('--out');
  if (!输出目录) throw new Error('缺少 --输出 <目录>');
  const 输入 = 参数('--输入') || 参数('--in');
  let cards, 数据来源;
  if (输入) {
    数据来源 = `离线文件:${path.basename(输入)}`;
    cards = 校验全量(JSON.parse(fs.readFileSync(输入, 'utf8')));
  } else {
    const baseUrl = 参数('--base-url', 'http://agent.tanyuai.com').replace(/\/$/, '');
    const profile = 参数('--profile');
    if (!profile) throw new Error('在线模式缺少 --profile <浏览器画像>');
    const 响应 = await 在线拉取({
      baseUrl,
      profile,
      browserChannel: 参数('--browser-channel'),
      playwrightCorePath: 参数('--playwright-core-path'),
      pageSize: Number(参数('--page-size', '5000')),
    });
    cards = 校验全量(响应);
    数据来源 = '在线 API';
  }
  const 基准日 = 解析基准日(参数('--判定基准日')) || new Date();
  const 汇总 = 运行巡检({ cards, 数据来源, 判定基准日: 基准日 });
  fs.mkdirSync(输出目录, { recursive: true });
  fs.writeFileSync(path.join(输出目录, '巡检-汇总.json'), JSON.stringify(汇总, null, 2));
  const md = 渲染md(汇总);
  for (const [文件名, 内容] of Object.entries(md)) fs.writeFileSync(path.join(输出目录, 文件名), 内容);
  console.log(`全库 ${汇总.meta.全库张数} 张（${数据来源}）`);
  console.log(`引流词候选 ${汇总.类别.引流词.候选数} 张；重复卡 同文 ${汇总.类别.重复卡.同文组数} 组 / 近似 ${汇总.类别.重复卡.近似组数} 组；停用卡 ${汇总.类别.停用卡.候选数} 张；绑店错位 ${汇总.类别.绑店错位.候选数} 张；过期时间词 ${汇总.类别.过期时间词.候选数} 张`);
  console.log(`输出目录：${输出目录}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    const 拉取不全 = e && /拉取不全|全库 total=0|全库读取失败|全库响应/.test(String(e.message));
    process.exitCode = 拉取不全 ? 2 : 1;
  });
}

module.exports = {
  引流词表,
  过期词表,
  相似度阈值,
  正文全文,
  归一化正文,
  绑店列表,
  范围签名,
  分片集,
  最小哈希签名,
  Jaccard,
  正文分组,
  近似分组,
  扫引流词,
  扫停用卡,
  扫绑店错位,
  扫过期时间词,
  运行巡检,
  渲染md,
  校验全量,
};
