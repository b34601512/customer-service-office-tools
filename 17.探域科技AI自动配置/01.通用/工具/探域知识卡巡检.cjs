// 探域知识卡巡检（只读）
// 意图：一次全库读取 + 本地判定，产出六类**候选**：引流词 / 重复卡 / 停用卡 / 绑店错位 / 过期时间词 / 电话号一致性。
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
// 输出：<目录>/巡检-汇总.json + 六类候选 md（引流词/重复卡/停用卡/绑店错位/过期时间词/电话号一致性）
//
// 口径说明：本脚本是「候选扫描器」，不代替人工判定；历史批次（A1/A5/B1/C1/D1/K2/D10）的人工核对数字见任务回执。
// 引流词（D10）：匹配前先归一化（NFKC 全角转半角 + 转小写 + 去空格/连字符/点），防「加 V」「微 信」「ｖｘ」这类变体漏扫；并补「背面的码/码进去」等不走「二维码」字面的引导句。
// 电话号一致性（K2）：先全角转半角、再去掉分隔符做归一化，能容下「400-830-2 19」这类带空格漏扫；主号在下方常量配置。
// 词表与阈值都在下方常量区，改口径只改常量。

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────── 常量区（口径） ───────────────────────────

// 引流词（A1 口径：正向引流才要改，反向劝阻/业务信息不算）
// D10 扩词：①「码」类变体（引导扫码但不写「二维码」字面）；②私聊/站外变体与谐音（加v/vx/威信/卫星/扣扣/公主号）；③站外平台名。
// 说明：扫码/站外/公众号/微信/加微信/微信号 等旧词保持原子串匹配；「企业微信」「关注公众号」已被「微信」「公众号」子串覆盖，不重复入表。
const 引流词表 = [
  '二维码', '背面的码', '后面的码', '底部的码', '机器上的码', '机身上的码', '码进去',
  '微信', '微信号', '加微信', '加v', 'vx', '威信', '卫星', '扣扣', '公主号',
  '抖音号', '小红书', '淘宝搜', '私域', '朋友圈',
  '加我', '私聊', 'QQ', '站外', '公众号', '扫码', '微店', '联系方式', '手机号', '电话'
];
// 引流词匹配前要去掉的字符（空格/连字符/点等；NFKC 已把全角符号折半）
const 引流分隔符正则 = /[\s\-‐‑‒–—−_·.]/;
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

// 电话号一致性（K2 口径）
// 主号：归一化后的正确号码，可配置多个（400 号码不在列表里 → 异常候选）
const 主号 = ['4008302119'];
// 号码最小位数（去掉分隔符后不足 8 位的不算电话号）
const 号码最小位数 = 8;
// 电话号候选 span 正则（半角化后的文本上用；前后不能是字母/数字，避免把批号/报告号里的片段当号）
const 号码候选正则 = /(?<![0-9A-Za-z])\d+(?:[\s.·\-‐‑‒–—−~～]+\d+)*(?![0-9A-Za-z])/g;
// 带空格/点/特殊横线/波浪号/全角字符的 → 算「奇怪分隔」写法，单独标出（纯「-」是常规写法，不算）
const 奇怪分隔正则 = /[\s.·‐‑‒–—−~～]/;
// 号码前文命中这些词 → 提示「疑似非电话」（验厂报告编号、订单号等）
const 非电话线索 = /(编号|报告编号|订单|单号|型号|序号|认证|标准|登记|证书|批号|IMEI|SN|SKU)[：:\s]*$/;

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

// 引流词归一化（D10 口径）：NFKC 全角转半角 + 转小写 + 去掉分隔符；
// 返回 {文本, 映射}，映射[i] = 归一化后第 i 个字符在 NFKC 文本里的下标，便于按原文截上下文。
function 归一化引流文本(s) {
  const NFKC文本 = String(s || '').normalize('NFKC').toLowerCase();
  let 文本 = '';
  const 映射 = [];
  for (let i = 0; i < NFKC文本.length; i++) {
    const ch = NFKC文本[i];
    if (引流分隔符正则.test(ch)) continue;
    文本 += ch;
    映射.push(i);
  }
  return { 文本, 映射 };
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
  const 词归一 = 引流词表
    .map((词) => ({ 词, 归一: 归一化引流文本(词).文本 }))
    .filter((x) => x.归一);
  for (const card of cards) {
    const 命中 = [];
    const 字段值 = [
      { 字段: 'title', 文本: 取标题(card) },
      { 字段: 'content', 文本: 正文全文(card) },
    ];
    for (const { 字段, 文本 } of 字段值) {
      if (!文本) continue;
      const { 文本: 归一, 映射 } = 归一化引流文本(文本);
      for (const { 词, 归一: 词文本 } of 词归一) {
        let i = 归一.indexOf(词文本);
        while (i >= 0) {
          const 原起 = 映射[i];
          const 原止 = 映射[i + 词文本.length - 1] + 1;
          const 上下文 = 摘上下文(文本, 原起, 原止 - 原起, 原止 - 原起);
          命中.push({ 词, 字段, 上下文 });
          i = 归一.indexOf(词文本, i + 词文本.length);
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

// ─────────────────────────── 类别 6：电话号一致性 ───────────────────────────

function 全角转半角(s) {
  return String(s || '')
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function 归一化号码(s) {
  return 全角转半角(s).replace(/[^\d]/g, '');
}

// 电话形状判定（归一化后的纯数字）；不是这三类形状的不算电话号
function 电话类别(数字) {
  if (/^400\d{5,9}$/.test(数字)) return '400热线';
  if (/^1[3-9]\d{8,10}$/.test(数字)) return '手机号';
  if (/^0\d{9,11}$/.test(数字)) return '座机';
  return null;
}

function 公共前缀长(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// 提取一张卡里所有电话号（标题 + 正文；保留原文写法与上下文，便于人工复核）
function 提取电话号(card) {
  const 结果 = [];
  const 字段值 = [
    { 字段: 'title', 文本: 取标题(card) },
    { 字段: 'content', 文本: 正文全文(card) },
  ];
  for (const { 字段, 文本 } of 字段值) {
    if (!文本) continue;
    const 半角 = 全角转半角(文本);
    const re = new RegExp(号码候选正则.source, 'g');
    let m;
    while ((m = re.exec(半角)) !== null) {
      const 原文写法 = 文本.slice(m.index, m.index + m[0].length);
      const 数字 = 归一化号码(m[0]);
      if (数字.length < 号码最小位数) continue;
      const 类别 = 电话类别(数字);
      if (!类别) continue;
      const 前文 = 半角.slice(Math.max(0, m.index - 8), m.index);
      结果.push({
        字段,
        数字,
        类别,
        原始: 原文写法,
        上下文: 摘上下文(文本, m.index, m[0].length, m[0].length),
        分隔怪: 奇怪分隔正则.test(原文写法) || /[\uFF01-\uFF5E\u3000]/.test(原文写法),
        疑似非电话: 非电话线索.test(前文),
      });
    }
  }
  return 结果;
}

// 异常判定（跨卡）：不在主号列表 → 异常；与主号（或同类号）同前缀但位数不同 → 疑似变体
function 判定电话异常(数字, 类别, 号码表, 主号集) {
  if (主号集.has(数字)) return [];
  const 原因 = [];
  const 同类主号 = [...主号集].filter((m) => 电话类别(m) === 类别);
  if (同类主号.length) {
    const 相近 = 同类主号.find((m) => m !== 数字 && m.length !== 数字.length && 公共前缀长(m, 数字) >= Math.min(6, Math.min(m.length, 数字.length)));
    if (相近) 原因.push(`与主号 ${相近} 同前缀但位数不同（本处 ${数字.length} 位 / 主号 ${相近.length} 位）`);
    else 原因.push(`与主号不同（主号：${同类主号.join('、')}）`);
    return 原因; // 有主号的类别以主号为准，不再和同类散号互相比对
  }
  if (类别 === '手机号' && 数字.length !== 11) 原因.push(`手机号应为 11 位，实际 ${数字.length} 位`);
  // 无主号的类别：只把「较短的那个」标为疑似漏字变体，避免把正常号也标上
  for (const [其他, 元] of 号码表) {
    if (其他 === 数字 || 元.类别 !== 类别 || 其他.length <= 数字.length) continue;
    if (公共前缀长(其他, 数字) >= Math.min(6, Math.min(其他.length, 数字.length))) {
      原因.push(`与 ${其他} 同前缀但位数不同（${数字.length} 位 vs ${其他.length} 位，疑似漏字）`);
      break;
    }
  }
  return 原因;
}

function 扫电话号一致性(cards) {
  const 号码表 = new Map(); // 归一化号码 → 全库统计
  const 卡号表 = new Map(); // 「卡id|号码」 → 单卡记录（用于异常/分隔清单）
  let 出现次数 = 0;
  for (const card of cards) {
    for (const occ of 提取电话号(card)) {
      出现次数++;
      if (!号码表.has(occ.数字)) {
        号码表.set(occ.数字, {
          号码: occ.数字,
          类别: occ.类别,
          位数: occ.数字.length,
          次数: 0,
          卡id集: new Set(),
          原始写法集: new Set(),
          上下文示例: [],
          疑似非电话: false,
        });
      }
      const 号 = 号码表.get(occ.数字);
      号.次数++;
      号.卡id集.add(String(card.id));
      号.原始写法集.add(occ.原始);
      if (号.上下文示例.length < 3) 号.上下文示例.push(occ.上下文);
      if (occ.疑似非电话) 号.疑似非电话 = true;

      const key = `${card.id}|${occ.数字}`;
      if (!卡号表.has(key)) {
        卡号表.set(key, {
          号码: occ.数字,
          类别: occ.类别,
          卡id: String(card.id),
          标题: 取标题(card),
          绑店: 绑店列表(card).map(店名).join(' / ') || '未绑店',
          次数: 0,
          原始: occ.原始,
          上下文: occ.上下文,
          分隔怪: false,
          疑似非电话: false,
        });
      }
      const 条 = 卡号表.get(key);
      条.次数++;
      if (occ.分隔怪) 条.分隔怪 = true;
      if (occ.疑似非电话) 条.疑似非电话 = true;
    }
  }
  const 主号集 = new Set(主号);
  const items = [...号码表.values()]
    .map((x) => ({
      号码: x.号码,
      类别: x.类别,
      位数: x.位数,
      次数: x.次数,
      卡数: x.卡id集.size,
      卡id: [...x.卡id集].sort(),
      原始写法: [...x.原始写法集].sort(),
      疑似非电话: x.疑似非电话,
      上下文示例: x.上下文示例,
    }))
    .sort((a, b) => String(a.号码).localeCompare(String(b.号码)));
  const 异常 = [];
  for (const 条 of 卡号表.values()) {
    const 原因 = 判定电话异常(条.号码, 条.类别, 号码表, 主号集);
    if (原因.length) 异常.push({ ...条, 原因 });
  }
  异常.sort((a, b) => String(a.卡id).localeCompare(String(b.卡id)) || String(a.号码).localeCompare(String(b.号码)));
  const 分隔异常 = [...卡号表.values()]
    .filter((x) => x.分隔怪)
    .sort((a, b) => String(a.卡id).localeCompare(String(b.卡id)) || String(a.号码).localeCompare(String(b.号码)));
  return {
    号码数: items.length,
    出现次数,
    涉及卡数: new Set(items.flatMap((x) => x.卡id)).size,
    异常数: 异常.length,
    异常卡数: new Set(异常.map((x) => x.卡id)).size,
    分隔异常数: 分隔异常.length,
    items,
    异常,
    分隔异常,
  };
}

// ─────────────────────────── 汇总与输出 ───────────────────────────

function 运行巡检({ cards, 数据来源, 判定基准日 }) {
  const 同文组 = 正文分组(cards);
  const 近似组 = 近似分组(cards);
  const 引流 = 扫引流词(cards);
  const 停用 = 扫停用卡(cards);
  const 绑店错位 = 扫绑店错位(cards);
  const 过期 = 扫过期时间词(cards, 判定基准日);
  const 电话 = 扫电话号一致性(cards);
  return {
    meta: {
      口径版本: 'D10-2026-10-02',
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
      电话号一致性: {
        号码数: 电话.号码数,
        出现次数: 电话.出现次数,
        涉及卡数: 电话.涉及卡数,
        异常数: 电话.异常数,
        异常卡数: 电话.异常卡数,
        分隔异常数: 电话.分隔异常数,
        items: 电话.items,
        异常: 电话.异常,
        分隔异常: 电话.分隔异常,
      },
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
  {
    const x = 汇总.类别.电话号一致性;
    const L = [
      `# 电话号一致性（只读扫描）`,
      ``,
      `- 号码 **${x.号码数}** 个 / 出现 **${x.出现次数}** 次 / 涉及 **${x.涉及卡数}** 张卡；异常 **${x.异常数}** 处 / **${x.异常卡数}** 张；带空格或奇怪分隔 **${x.分隔异常数}** 处`,
      `- 主号（常量配置，归一化后）：${主号.join('、')}；400 号码不在主号列表里 → 异常候选`,
      ``,
      `## 号码统计`,
      ``,
      `| 号码 | 类别 | 位数 | 次数 | 卡数 | 原始写法 | 疑似非电话 | 卡 id（最多列 10 个） |`,
      `|---|---|---|---|---|---|---|---|`,
    ];
    for (const it of x.items) {
      const 卡id = it.卡id.slice(0, 10).join(', ') + (it.卡id.length > 10 ? ` …等 ${it.卡id.length} 张` : '');
      L.push(`| ${it.号码} | ${it.类别} | ${it.位数} | ${it.次数} | ${it.卡数} | ${行(it.原始写法.join(' / '))} | ${it.疑似非电话 ? '是' : ''} | ${行(卡id)} |`);
    }
    L.push(``, `## 疑似变体 / 异常`, ``);
    if (!x.异常.length) L.push('（无）');
    else {
      L.push(`| 号码 | 类别 | 原因 | 卡 id | 标题 | 次数 | 原始 | 上下文 |`, `|---|---|---|---|---|---|---|---|`);
      for (const it of x.异常) L.push(`| ${it.号码} | ${it.类别} | ${行(it.原因.join('；'))} | ${it.卡id} | ${行(it.标题)} | ${it.次数} | ${行(it.原始)} | ${行(it.上下文)} |`);
    }
    L.push(``, `## 带空格 / 奇怪分隔的写法`, ``);
    if (!x.分隔异常.length) L.push('（无）');
    else {
      L.push(`| 号码 | 原始写法 | 卡 id | 标题 | 次数 | 上下文 |`, `|---|---|---|---|---|---|`);
      for (const it of x.分隔异常) L.push(`| ${it.号码} | ${行(it.原始)} | ${it.卡id} | ${行(it.标题)} | ${it.次数} | ${行(it.上下文)} |`);
    }
    文件['电话号一致性-候选.md'] = L.join('\n');
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
  console.log(`电话号一致性：号码 ${汇总.类别.电话号一致性.号码数} 个（异常 ${汇总.类别.电话号一致性.异常数} 处 / ${汇总.类别.电话号一致性.异常卡数} 张；带空格/怪分隔 ${汇总.类别.电话号一致性.分隔异常数} 处）`);
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
  引流分隔符正则,
  过期词表,
  主号,
  相似度阈值,
  正文全文,
  归一化正文,
  归一化引流文本,
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
  归一化号码,
  电话类别,
  扫电话号一致性,
  运行巡检,
  渲染md,
  校验全量,
};
