// 该文件用于验证「截图凭证已停用」：催票流程不再截图，也不会因为截图失败把已完成的识别判成失败。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { 是否保存截图凭证 } = require('../src/common/screenshotEvidenceSettings');
const { 保存轻量截图 } = require('../src/app/checkInvoiceUrges');

function 造假的页面(记录) {
  return {
    screenshot: async (选项) => {
      记录.push(选项);
      throw new Error('截图不应该被调用');
    },
  };
}

test('截图凭证默认关闭，且可用环境变量临时恢复', () => {
  const 原值 = process.env.PI_EVIDENCE_SCREENSHOTS;
  try {
    delete process.env.PI_EVIDENCE_SCREENSHOTS;
    assert.equal(是否保存截图凭证(), false);
    process.env.PI_EVIDENCE_SCREENSHOTS = '1';
    assert.equal(是否保存截图凭证(), true);
    process.env.PI_EVIDENCE_SCREENSHOTS = 'off';
    assert.equal(是否保存截图凭证(), false);
  } finally {
    if (原值 === undefined) {
      delete process.env.PI_EVIDENCE_SCREENSHOTS;
    } else {
      process.env.PI_EVIDENCE_SCREENSHOTS = 原值;
    }
  }
});

test('停用后保存轻量截图不落盘、不调用浏览器、也不抛错', async () => {
  const 原值 = process.env.PI_EVIDENCE_SCREENSHOTS;
  delete process.env.PI_EVIDENCE_SCREENSHOTS;
  try {
    const 记录 = [];
    const 目标路径 = path.join(
      fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'urge-screenshot-off-')),
      '京东1店-批量识别.png'
    );
    const 结果 = await 保存轻量截图(造假的页面(记录), 目标路径);
    assert.equal(结果, '', '停用后应返回空路径');
    assert.deepEqual(记录, [], '停用后不允许调用浏览器截图');
    assert.equal(fs.existsSync(目标路径), false, '停用后不允许生成截图文件');
  } finally {
    if (原值 === undefined) {
      delete process.env.PI_EVIDENCE_SCREENSHOTS;
    } else {
      process.env.PI_EVIDENCE_SCREENSHOTS = 原值;
    }
  }
});

test('开关打开时仍会截图并校验凭证文件', async () => {
  const 原值 = process.env.PI_EVIDENCE_SCREENSHOTS;
  process.env.PI_EVIDENCE_SCREENSHOTS = '1';
  try {
    const 目标路径 = path.join(
      fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'urge-screenshot-on-')),
      '京东1店-批量识别.png'
    );
    const 记录 = [];
    const 页面 = {
      screenshot: async (选项) => {
        记录.push(选项);
        fs.writeFileSync(选项.path, 'png');
      },
    };
    const 结果 = await 保存轻量截图(页面, 目标路径);
    assert.equal(结果, 目标路径);
    assert.equal(记录.length, 1);
    assert.equal(fs.existsSync(目标路径), true);
  } finally {
    if (原值 === undefined) {
      delete process.env.PI_EVIDENCE_SCREENSHOTS;
    } else {
      process.env.PI_EVIDENCE_SCREENSHOTS = 原值;
    }
  }
});
