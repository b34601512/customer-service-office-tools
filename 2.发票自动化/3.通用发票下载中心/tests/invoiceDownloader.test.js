const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { 规范化订单号列表, 批量下载发票 } = require('../src/nuonuo/invoiceDownloader');
const { 记录已下载发票 } = require('../src/invoices/invoiceFileStore');

test('订单号列表会去重并移除空值', () => {
  assert.deepEqual(规范化订单号列表([' 1001 ', '', '1001', '1002']), ['1001', '1002']);
});

test('诺诺接口找不到发票时会明确返回缺失订单', async () => {
  await assert.rejects(
    () => 批量下载发票(['1001'], { providerDownloadMethod: async () => [] }),
    /没有找到可下载发票/,
  );
});

test('已有本地发票时批量下载直接返回缓存文件', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-download-'));
  const filePath = path.join(temp, '1003.pdf');
  const indexPath = path.join(temp, 'index.json');
  fs.writeFileSync(filePath, 'pdf', 'utf8');
  记录已下载发票({ orderNumber: '1003', invoiceFilePath: filePath, invoiceNumber: '26952000002820665311', source: 'test' }, indexPath);

  const result = await 批量下载发票(['1003'], { indexFilePath: indexPath });

  assert.equal(result[0].orderNumber, '1003');
  assert.equal(result[0].invoiceFilePath, filePath);
  assert.equal(result[0].invoiceNumber, '26952000002820665311');
});

test('没有发票号码的本地文件也按有效缓存复用', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-local-cache-'));
  const filePath = path.join(temp, '1004.pdf');
  const indexPath = path.join(temp, 'index.json');
  fs.writeFileSync(filePath, 'pdf', 'utf8');
  记录已下载发票({ orderNumber: '1004', invoiceFilePath: filePath, source: 'manual-import' }, indexPath);

  const result = await 批量下载发票(['1004'], {
    indexFilePath: indexPath,
    providerDownloadMethod: async () => {
      throw new Error('有效本地缓存不应再次查询诺诺。');
    },
  });

  assert.equal(result[0].invoiceFilePath, filePath);
  assert.equal(result[0].invoiceNumber, '');
  assert.equal(result[0].source, 'manual-import');
});
