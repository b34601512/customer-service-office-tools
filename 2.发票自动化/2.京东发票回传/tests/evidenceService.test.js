const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  验证凭证文件,
  规范化凭证名称,
} = require('../src/common/evidenceService');

test('凭证名称会把非法字符换成短横线', () => {
  assert.equal(规范化凭证名称('京东/2店'), '京东-2店');
});

test('凭证验证会拒绝不存在或空文件', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-invoice-evidence-'));
  const 空文件路径 = path.join(临时目录, 'empty.png');
  const 有内容文件路径 = path.join(临时目录, 'success.png');
  try {
    fs.writeFileSync(空文件路径, '');
    fs.writeFileSync(有内容文件路径, Buffer.from([1, 2, 3]));
    assert.throws(() => 验证凭证文件(path.join(临时目录, 'missing.png')), /截图凭证未生成/);
    assert.throws(() => 验证凭证文件(空文件路径), /截图凭证为空/);
    assert.equal(验证凭证文件(有内容文件路径), path.resolve(有内容文件路径));
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});
