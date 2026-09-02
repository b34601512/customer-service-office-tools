const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { 子项目定义列表 } = require('./导出客服分发包');

test('总分发包为五个平台准备 v2 隔离订单仓库', () => {
  const expectedFiles = new Map([
    ['1.京东开票巡检', 'invoice-order-state.json'],
    ['2.京东发票回传', 'invoice-urge-orders.json'],
    ['4.天猫发票回传', 'invoice-order-records.json'],
    ['5.拼多多发票回传', 'invoice-order-records.json'],
    ['6.抖音发票回传', 'invoice-order-records.json'],
  ]);
  for (const [projectName, fileName] of expectedFiles) {
    const project = 子项目定义列表.find((item) => item.目录名称 === projectName);
    const [, data] = project.数据文件列表.find(([name]) => name === fileName);
    assert.equal(data.version, 2);
    assert.deepEqual(data.orders, {});
  }
  const downloadCenter = 子项目定义列表.find((item) => item.目录名称 === '3.通用发票下载中心');
  assert.equal(downloadCenter.数据文件列表.some(([name]) => name.includes('order-record')), false);
});

test('总分发和京东便携包都复制三个共享运行目录', () => {
  const files = [
    '导出客服分发包.js',
    '1.京东开票巡检/src/release/buildPortablePackage.js',
    '2.京东发票回传/src/release/buildPortablePackage.js',
  ];
  for (const fileName of files) {
    const text = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
    assert.match(text, /共享CLI/);
    assert.match(text, /共享订单状态/);
    assert.match(text, /共享发票回传/);
    assert.doesNotMatch(text, /control-center-window/);
  }
});
