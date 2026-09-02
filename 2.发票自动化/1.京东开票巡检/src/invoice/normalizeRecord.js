const crypto = require('crypto');

function 规范化文本(文本) {
  // 解决：把网页和接口里杂乱的空白字符压缩成稳定文本，减少误报。
  return String(文本 ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((行) => 行.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ')
    .trim();
}

function 转换字段值(值) {
  // 解决：将复杂值收敛成可展示的稳定字符串，保证快照可落盘。
  if (值 === null || 值 === undefined) {
    return '';
  }

  if (Array.isArray(值)) {
    return 规范化文本(值.map((项目) => 转换字段值(项目)).filter(Boolean).join('、'));
  }

  if (typeof 值 === 'object') {
    return 规范化文本(JSON.stringify(值, null, 0));
  }

  return 规范化文本(String(值));
}

function 构建字段摘要(字段) {
  // 解决：把记录字段拼成对人可读的摘要，供提醒和差异对比复用。
  return Object.entries(字段)
    .map(([键, 值]) => {
      const 规范键 = 规范化文本(键);
      const 规范值 = 转换字段值(值);
      if (!规范键 && !规范值) {
        return '';
      }
      return 规范键 && 规范值 ? `${规范键}:${规范值}` : (规范键 || 规范值);
    })
    .filter(Boolean)
    .join('；');
}

function 生成记录标识(来源, 摘要) {
  // 解决：用来源和摘要生成稳定哈希，支持跨轮次去重。
  return crypto.createHash('sha256').update(`${来源}\n${摘要}`, 'utf8').digest('hex');
}

function 规范化记录(原始记录, 来源 = '未知来源') {
  // 解决：统一页面记录和接口记录的数据结构，降低后续比较复杂度。
  if (!原始记录 || typeof 原始记录 !== 'object') {
    throw new Error('记录内容为空，无法规范化。');
  }

  const 字段 = Object.fromEntries(
    Object.entries(原始记录)
      .map(([键, 值]) => [键, 转换字段值(值)])
      .filter(([, 值]) => 值),
  );

  const 摘要 = 规范化文本(
    字段.摘要
    || 字段.标题
    || 字段.文本
    || 字段.行内容
    || 构建字段摘要(字段),
  );

  if (!摘要) {
    throw new Error('记录摘要为空，无法建立快照。');
  }

  return {
    id: 生成记录标识(来源, 摘要),
    source: 来源,
    summary: 摘要,
    fields: 字段,
  };
}

module.exports = {
  规范化文本,
  规范化记录,
};
