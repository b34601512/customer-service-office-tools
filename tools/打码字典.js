/**
 * 打码字典（本机私有 ↔ GitHub 打码值）
 *
 * 为什么：本仓库是**公开**的（见 `开源边界.md`），但本地要能用。
 * 做法：文档/代码提交时由 `tools/打码过滤器.js` 把「真值 → 打码值」，检出时「打码值 → 真值」。
 * 于是：**本机文件里全是真值、GitHub 上全是打码值**，两边都不影响使用。
 *
 * 本文件只放通用规则；**真值不写在这里**，写在本机 `tools/打码对照.local`（已被 .gitignore 排除）。
 */
const fs = require('fs');
const path = require('path');

const 仓库根 = path.join(__dirname, '..');
const 对照文件 = path.join(__dirname, '打码对照.local');

/** 明确不打码的白名单（常见词/占位，防止误伤） */
const 不打的词 = new Set([
  '客服部', '客服口径', '客服群', '客服先回', '客服服务', '小芳休', '小时', '小计',
  '13800000000', '18000000000', '13800138000', '19900000000', '13900000000', '18000015000', '18000001500',
]);

function 读对照() {
  try {
    const j = JSON.parse(fs.readFileSync(对照文件, 'utf8'));
    return j && typeof j.表 === 'object' ? j.表 : {};
  } catch (e) {
    return {};
  }
}

function 写对照(表) {
  const 内容 = {
    说明: '本机私有：GitHub 上的打码值 ↔ 本机真值 对照表。不入库（*.local 已被 .gitignore 排除）。',
    更新时间: new Date().toISOString(),
    表,
  };
  fs.writeFileSync(对照文件, JSON.stringify(内容, null, 2) + '\n', 'utf8');
}

/** 生成一个「保形」的打码值：长度/形状基本不变，方便测试与阅读 */
function 生成打码值(真值) {
  if (/^s3_[A-Za-z0-9]{10,}$/.test(真值)) return 's3_' + '*'.repeat(真值.length - 3);
  if (/^wo[A-Za-z0-9_-]{20,}$/.test(真值)) return 'wo' + '*'.repeat(真值.length - 2);
  if (/^\d{6}-\d{9,15}$/.test(真值)) {
    const [日, 尾] = 真值.split('-');
    return `${日}-${'*'.repeat(尾.length - 4)}${尾.slice(-4)}`;
  }
  if (/^(SF|JDV|YT|ZTO|JT|EMS|YD)\d{10,}$/.test(真值)) {
    const 头 = 真值.slice(0, 2);
    return 头 + '*'.repeat(真值.length - 6) + 真值.slice(-4);
  }
  if (/^1[3-9]\d{9}$/.test(真值)) return 真值.slice(0, 3) + '****' + 真值.slice(-4);
  if (/^(客服|小).$/.test(真值)) return 真值.slice(0, -1) + '某';
  if (/^[：:](客服|小)./.test(真值) && 真值.length <= 5) return 真值.slice(0, -1) + '某';
  if (/^[\u4e00-\u9fa5]{2,4}$/.test(真值)) return 真值[0] + '某某'.slice(0, 真值.length - 1);
  return '<打码值>';
}

/** 替换：方向 = '打码'（真值→打码）或 '还原'（打码→真值） */
function 替换(文本, 方向, 表) {
  const 映射 = 方向 === '打码' ? 表 : Object.fromEntries(Object.entries(表).map(([k, v]) => [v, k]));
  const 键 = Object.keys(映射).filter((k) => k && k !== '说明').sort((a, b) => b.length - a.length);
  let 出 = 文本;
  for (const k of 键) {
    if (不打的词.has(k)) continue;
    if (出.includes(k)) 出 = 出.split(k).join(映射[k]);
  }
  return 出;
}

module.exports = { 仓库根, 对照文件, 不打的词, 读对照, 写对照, 生成打码值, 替换 };
