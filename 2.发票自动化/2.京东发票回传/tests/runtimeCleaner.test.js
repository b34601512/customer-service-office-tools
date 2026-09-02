const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  清理店铺浏览器缓存,
  构建备份目标路径,
  店铺缓存相对路径列表,
} = require('../src/common/runtimeCleaner');
const { 读取性能清理摘要 } = require('../src/common/performanceCleanupState');

function 写入测试文件(文件路径, 字节数) {
  // 该函数只在临时目录里造测试文件，模拟浏览器缓存膨胀。
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, Buffer.alloc(字节数, 1));
}

function 创建临时项目目录() {
  // 该函数为每个用例创建独立项目根，避免测试碰真实 runtime。
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jd-invoice-runtime-cleaner-'));
}

test('店铺缓存清理只迁移缓存目录，不碰登录态目录', () => {
  const projectRoot = 创建临时项目目录();
  const 备份根目录 = path.join(projectRoot, 'backup');
  const profileRoot = path.join(projectRoot, 'runtime', 'store-profiles', '京东1店');
  const cacheFile = path.join(profileRoot, 'Default', 'Cache', 'Cache_Data', 'data_3');
  const codeCacheFile = path.join(profileRoot, 'Default', 'Code Cache', 'js', 'small-cache');
  const localStorageFile = path.join(profileRoot, 'Default', 'Local Storage', 'leveldb', '000003.log');
  const indexedDbFile = path.join(profileRoot, 'Default', 'IndexedDB', 'https_jdsz.jd.com_0.indexeddb.leveldb', '000003.log');
  const cookieFile = path.join(profileRoot, 'Default', 'Network', 'Cookies');

  写入测试文件(cacheFile, 32);
  写入测试文件(codeCacheFile, 8);
  写入测试文件(localStorageFile, 128);
  写入测试文件(indexedDbFile, 128);
  写入测试文件(cookieFile, 128);

  const result = 清理店铺浏览器缓存({
    店铺标识: '京东1店',
    浏览器目录路径: profileRoot,
    projectRoot,
    备份根目录,
    now: new Date('2026-06-29T08:00:00Z'),
  });

  assert.equal(result.length, 2);
  assert.equal(fs.existsSync(path.join(profileRoot, 'Default', 'Cache')), false);
  assert.equal(fs.existsSync(path.join(profileRoot, 'Default', 'Code Cache')), false);
  assert.equal(fs.existsSync(localStorageFile), true);
  assert.equal(fs.existsSync(indexedDbFile), true);
  assert.equal(fs.existsSync(cookieFile), true);
  assert.equal(fs.existsSync(result[0].备份路径), true);
  assert.equal(result.some((item) => /Default[\\/]Cache$/.test(item.备份路径)), true);
  assert.equal(result.some((item) => /Default[\\/]Code Cache$/.test(item.备份路径)), true);

  const summary = 读取性能清理摘要({ projectRoot });
  assert.equal(summary.totals.runCount, 1);
  assert.equal(summary.totals.movedCount, 2);
  assert.equal(summary.autoCleanupRuns[0].cleanupType, 'store-browser-cache');
});

test('店铺垃圾清理计划不包含登录态目录', () => {
  const planText = 店铺缓存相对路径列表.map((parts) => parts.join('/')).join('\n');

  assert.doesNotMatch(planText, /Local Storage/);
  assert.doesNotMatch(planText, /IndexedDB/);
  assert.doesNotMatch(planText, /Network/);
  assert.match(planText, /Code Cache/);
  assert.match(planText, /Cache/);
});

test('备份目标路径保留项目内相对路径', () => {
  const projectRoot = 创建临时项目目录();
  const 备份根目录 = path.join(projectRoot, 'backup');
  const targetPath = path.join(projectRoot, 'runtime', 'store-profiles', '京东1店', 'Default', 'Cache');
  const backupPath = 构建备份目标路径(targetPath, {
    projectRoot,
    备份根目录,
    now: new Date('2026-06-29T08:00:00Z'),
  });

  assert.match(backupPath, /backup[\\/]京东催促开票-runtime缓存备份[\\/]/);
  assert.match(backupPath, /runtime[\\/]store-profiles[\\/]京东1店[\\/]Default[\\/]Cache$/);
});
