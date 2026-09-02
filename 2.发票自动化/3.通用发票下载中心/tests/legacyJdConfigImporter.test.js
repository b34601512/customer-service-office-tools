const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { 导入旧京东发票系统配置 } = require('../src/config/legacyJdConfigImporter');

test('可以从旧京东项目导入诺诺配置并复制登录态', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-jd-'));
  const legacyData = path.join(temp, 'data');
  fs.mkdirSync(legacyData, { recursive: true });
  fs.writeFileSync(path.join(legacyData, 'stores.json'), JSON.stringify({
    invoiceSystem: {
      targetUrl: 'https://work.nuonuo.com/index',
      username: 'nuonuo-user',
      password: 'nuonuo-pass',
    },
  }), 'utf8');
  fs.writeFileSync(path.join(legacyData, 'invoice-system-auth-state.json'), '{"cookies":[]}', 'utf8');

  const output = path.join(temp, 'new');
  const result = 导入旧京东发票系统配置({
    legacyProjectDirectory: temp,
    configFilePath: path.join(output, 'config.json'),
    authStateFilePath: path.join(output, 'auth.json'),
  });

  assert.equal(result.config.hasUsername, true);
  assert.equal(result.config.usernameMasked, 'nuo***er');
  assert.equal(result.config.hasPassword, true);
  assert.equal(result.copiedAuthState, true);
  assert.equal(fs.existsSync(path.join(output, 'auth.json')), true);
});
