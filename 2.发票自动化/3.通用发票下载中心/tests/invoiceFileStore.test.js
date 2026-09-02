const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  清理文件名片段,
  记录已下载发票,
  查找本地发票,
  登记本地发票文件,
} = require('../src/invoices/invoiceFileStore');

test('文件名片段会清理 Windows 非法字符', () => {
  assert.equal(清理文件名片段(' 35<26>239/00? '), '35-26-239-00');
});

test('发票文件登记后可以按订单号查回', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-index-'));
  const filePath = path.join(temp, '1001.pdf');
  const indexPath = path.join(temp, 'index.json');
  fs.writeFileSync(filePath, 'pdf', 'utf8');

  const saved = 记录已下载发票({
    orderNumber: '1001',
    invoiceFilePath: filePath,
    source: 'test',
    invoiceSubjectName: '测试主体',
  }, indexPath);
  const found = 查找本地发票('1001', indexPath);

  assert.equal(saved.invoiceFilePath, filePath);
  assert.equal(found.invoiceFilePath, filePath);
  assert.equal(found.source, 'test');
  assert.equal(found.invoiceSubjectName, '测试主体');
});

test('本地发票导入会复制到订单独立目录并写入索引', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-local-'));
  const filePath = path.join(temp, 'origin.pdf');
  const indexPath = path.join(temp, 'index.json');
  fs.writeFileSync(filePath, 'pdf', 'utf8');

  const saved = 登记本地发票文件({ orderNumber: '1002', invoiceFilePath: filePath }, indexPath);

  assert.equal(path.basename(saved.invoiceFilePath), '1002.pdf');
  assert.equal(fs.existsSync(saved.invoiceFilePath), true);
});
