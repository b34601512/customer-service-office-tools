const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { 报告目录 } = require('../common/paths');
const { 写入文本文件 } = require('../common/fs');
const {
  是否已处理,
  是否已登记,
  是否处理中,
} = require('../order/jdOrderRecordStore');

function 规范化单元格(字段值) {
  return String(字段值 ?? '').replace(/\r?\n/g, ' ').replace(/\t/g, ' ').trim();
}

function 是否可导出跟进订单(订单) {
  return !是否已处理(订单) && 是否处理中(订单);
}

function 构建跟进表行(订单) {
  return [
    是否已登记(订单) ? '发票已登记' : '处理中',
    订单.storeName || '',
    订单.orderNumber || '',
    订单.assigneeName || '',
    订单.noteText || '',
    订单.invoiceStatusText || '',
    订单.invoiceCountdownText || '',
    订单.invoiceAmountText || '',
    订单.invoiceTitle || '',
    订单.invoiceReturned ? '已回传' : '',
  ];
}

function 构建跟进表文本(订单列表 = []) {
  const 表头 = ['处理阶段', '店铺', '订单号', '跟进客服', '备注', '后台发票状态', '开票倒计时', '发票金额', '发票抬头', '是否已回传'];
  const 可导出订单列表 = (Array.isArray(订单列表) ? 订单列表 : []).filter(是否可导出跟进订单);
  if (!可导出订单列表.length) {
    throw new Error('没有可导出的处理中或发票已登记订单。');
  }
  return {
    count: 可导出订单列表.length,
    text: [表头, ...可导出订单列表.map(构建跟进表行)]
      .map((行) => 行.map(规范化单元格).join('\t'))
      .join('\r\n'),
  };
}

function 构建导出文件路径(时间 = new Date()) {
  const 补齐两位 = (数值) => String(数值).padStart(2, '0');
  const 文件名 = `客服跟进表-${时间.getFullYear()}${补齐两位(时间.getMonth() + 1)}${补齐两位(时间.getDate())}-${补齐两位(时间.getHours())}${补齐两位(时间.getMinutes())}${补齐两位(时间.getSeconds())}.tsv`;
  return path.join(报告目录, 文件名);
}

function 复制到系统剪贴板(文本, 平台 = process.platform) {
  const 剪贴板命令 = 平台 === 'win32'
    ? { program: 'clip.exe', args: [] }
    : 平台 === 'darwin'
      ? { program: 'pbcopy', args: [] }
      : { program: 'xclip', args: ['-selection', 'clipboard'] };
  const 结果 = spawnSync(剪贴板命令.program, 剪贴板命令.args, {
    input: 文本,
    encoding: 'utf8',
    windowsHide: true,
  });
  return !结果.error && 结果.status === 0;
}

function 导出跟进表(订单列表 = []) {
  const 表格 = 构建跟进表文本(订单列表);
  const 文件路径 = 构建导出文件路径();
  写入文本文件(文件路径, 表格.text);
  return {
    ...表格,
    filePath: 文件路径,
    copiedToClipboard: 复制到系统剪贴板(表格.text),
  };
}

module.exports = {
  构建跟进表文本,
  构建导出文件路径,
  复制到系统剪贴板,
  导出跟进表,
};
