const path = require('path');
const { 报告目录 } = require('../common/paths');
const { 写入文本文件 } = require('../common/fs');
const { 格式化时间, 生成时间戳文件名 } = require('../common/time');

function 生成记录文本(记录, 序号) {
  // 解决：把记录转换成易读的报告段落，方便你直接查看开票信息。
  const 字段行 = Object.entries(记录.fields)
    .map(([键, 值]) => `${键}：${值}`)
    .join('\n');
  return `第 ${序号} 条\n来源：${记录.source}\n摘要：${记录.summary}\n${字段行}`;
}

function 保存巡检报告(结果) {
  // 解决：为每次发现待登记记录的巡检生成文本凭据，便于后续追溯和核对。
  const 文件名 = `巡检报告-${生成时间戳文件名()}.txt`;
  const 文件路径 = path.join(报告目录, 文件名);
  const 正文 = [
    `巡检时间：${格式化时间()}`,
    `店铺名称：${结果.storeName || '未命名店铺'}`,
    `页面标题：${结果.pageTitle}`,
    `页面地址：${结果.pageUrl}`,
    `提醒记录数：${结果.newRecords.length}`,
    '',
    ...结果.newRecords.map((记录, 索引) => 生成记录文本(记录, 索引 + 1)),
    '',
    '页面预览：',
    结果.pagePreview || '无',
  ].join('\n');

  写入文本文件(文件路径, 正文);
  return 文件路径;
}

module.exports = {
  保存巡检报告,
};
