const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  默认发票系统地址,
  默认发票查询最近天数,
  规范化发票系统配置,
  规范化发票查询最近天数,
  读取发票系统配置,
  保存发票系统配置,
} = require('../src/config/invoiceSystemConfig');

function 创建临时配置路径() {
  // 该函数为配置测试创建隔离文件，避免污染真实配置。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-center-config-'));
  return path.join(dir, 'config.json');
}

test('发票系统配置默认使用诺诺工作台', () => {
  const config = 规范化发票系统配置({});
  assert.equal(config.provider, 'nuonuo');
  assert.equal(config.targetUrl, 默认发票系统地址);
  assert.equal(config.invoiceSearchRangeDays, 默认发票查询最近天数);
});

test('发票查询最近天数默认30天且限制范围', () => {
  assert.equal(规范化发票查询最近天数(undefined), 30);
  assert.equal(规范化发票查询最近天数('15'), 15);
  assert.throws(() => 规范化发票查询最近天数('366'), /1 到 365/);
});

test('发票系统配置保存后能再次读取', () => {
  const file = 创建临时配置路径();
  保存发票系统配置({
    provider: 'nuonuo',
    targetUrl: 'https://work.nuonuo.com/index',
    username: ' user ',
    password: 'pass',
    invoiceSearchRangeDays: 45,
  }, file);
  const config = 读取发票系统配置(file);
  assert.equal(config.username, 'user');
  assert.equal(config.password, 'pass');
  assert.equal(config.invoiceSearchRangeDays, 45);
});
