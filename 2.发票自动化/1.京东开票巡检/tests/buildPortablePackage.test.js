const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  构建分发初始店铺配置,
  解析发布信息,
  获取分发根文件列表,
  校验客服分发包不含敏感数据,
} = require('../src/release/buildPortablePackage');
const {
  创建自动递增发布计划,
  递增显示版本,
} = require('../src/release/packageVersionService');

test('发布信息应该优先读取打包配置里的对外版本号', () => {
  const 发布信息 = 解析发布信息(
    { version: '0.0.1' },
    { displayVersion: '0.25' },
  );

  assert.deepEqual(发布信息, {
    内部版本: '0.0.1',
    显示版本: '0.25',
  });
});

test('分发包初始店铺配置不应该携带真实店铺信息', () => {
  const 分发配置 = 构建分发初始店铺配置();

  assert.equal(Array.isArray(分发配置.stores), true);
  assert.equal(分发配置.stores.length, 1);
  assert.deepEqual(分发配置.stores[0], {
    id: 'default-store',
    name: '默认店铺',
    targetUrl: 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html',
    username: '',
    password: '',
    enabled: false,
  });
});

test('分发根目录文件列表必须包含打包配置文件', () => {
  const 文件列表 = 获取分发根文件列表();

  assert.equal(文件列表.includes('打包配置.json'), true);
});

test('对外显示版本应该自动递增末尾数字并保留补零宽度', () => {
  assert.equal(递增显示版本('0.03'), '0.04');
  assert.equal(递增显示版本('0.09'), '0.10');
  assert.equal(递增显示版本('release-009'), 'release-010');
});

test('对外显示版本末尾不是数字时应该直接抛错', () => {
  assert.throws(
    () => 递增显示版本('版本A'),
    /版本号末尾必须是数字/,
  );
});

test('自动递增发布计划应该从打包配置计算本次新版本', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-release-version-'));
  fs.writeFileSync(
    path.join(临时目录, 'package.json'),
    JSON.stringify({ version: '0.0.1' }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(临时目录, '打包配置.json'),
    JSON.stringify({ displayVersion: '0.03' }, null, 2),
    'utf8',
  );

  const 发布计划 = 创建自动递增发布计划(临时目录);

  assert.equal(发布计划.当前发布信息.显示版本, '0.03');
  assert.equal(发布计划.新发布信息.显示版本, '0.04');
  assert.equal(发布计划.新打包配置.displayVersion, '0.04');
});

test('分发包安全校验应该放行空白店铺模板和空运行目录', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-package-safe-'));
  fs.mkdirSync(path.join(临时目录, 'data'), { recursive: true });
  fs.mkdirSync(path.join(临时目录, 'runtime', 'edge-profile'), { recursive: true });
  fs.mkdirSync(path.join(临时目录, 'runtime', 'store-profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(临时目录, 'data', 'stores.json'),
    JSON.stringify(构建分发初始店铺配置(), null, 2),
    'utf8',
  );

  const 校验结果 = 校验客服分发包不含敏感数据(临时目录);

  assert.deepEqual(校验结果, {
    店铺数量: 1,
    残留文件数量: 0,
  });
});

test('分发包安全校验发现账号密码时应该直接阻止打包', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-package-secret-'));
  fs.mkdirSync(path.join(临时目录, 'data'), { recursive: true });
  fs.mkdirSync(path.join(临时目录, 'runtime'), { recursive: true });
  fs.writeFileSync(
    path.join(临时目录, 'data', 'stores.json'),
    JSON.stringify({
      stores: [
        {
          id: 'real-store',
          name: '真实店铺',
          username: 'hidden-user',
          password: 'hidden-password',
          enabled: true,
        },
      ],
    }, null, 2),
    'utf8',
  );

  assert.throws(
    () => 校验客服分发包不含敏感数据(临时目录),
    /仍包含账号或密码/,
  );
});

test('分发包安全校验发现浏览器登录态文件时应该直接阻止打包', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-package-profile-'));
  fs.mkdirSync(path.join(临时目录, 'data'), { recursive: true });
  fs.mkdirSync(path.join(临时目录, 'runtime', 'edge-profile'), { recursive: true });
  fs.writeFileSync(
    path.join(临时目录, 'data', 'stores.json'),
    JSON.stringify(构建分发初始店铺配置(), null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(临时目录, 'runtime', 'edge-profile', 'Cookies'), 'cookie', 'utf8');

  assert.throws(
    () => 校验客服分发包不含敏感数据(临时目录),
    /登录态或缓存文件/,
  );
});
