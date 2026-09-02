const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('登录等待逻辑不会在已填充后继续反复填账号密码', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'browser', 'tmallAuthenticatedPage.js'),
    'utf8',
  );
  assert.equal(source.includes('if (!已填充 || 是天猫登录页面(当前地址))'), false);
  assert.equal(source.includes('if (!已填充)'), true);
});
