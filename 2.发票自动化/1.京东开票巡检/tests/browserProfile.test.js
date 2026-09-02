const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  构建浏览器缓存启动参数,
  检查并处理运行目录膨胀,
  清理浏览器资料目录可再生缓存,
  获取浏览器资料目录列表,
} = require('../src/runtime/browserProfile');

function 写入测试文件(文件路径, 内容 = 'demo') {
  // 解决：测试里快速构造浏览器资料文件，避免每个用例重复创建父目录。
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, 内容, 'utf8');
}

test('浏览器缓存治理旧入口已经移除，避免新旧实现混用', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'runtime', 'browserProfileMaintenance.js')), false);
});

test('浏览器缓存清理只迁移可再生缓存并保留登录态文件', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-profile-maintenance-'));
  const runtimeDir = path.join(临时目录, 'runtime');
  const backupRoot = path.join(临时目录, 'backup');
  const profileDir = path.join(runtimeDir, 'store-profiles', '京东2店');

  写入测试文件(path.join(profileDir, 'Default', 'Cache', 'Cache_Data', 'data_3'), 'cache');
  写入测试文件(path.join(profileDir, 'Default', 'Code Cache', 'js', 'index'), 'code');
  写入测试文件(path.join(profileDir, 'GrShaderCache', 'data_3'), 'shader');
  写入测试文件(path.join(profileDir, 'BrowserMetrics-spare.pma'), 'metrics');
  写入测试文件(path.join(profileDir, 'Default', 'Network', 'Cookies'), 'cookie');
  写入测试文件(path.join(profileDir, 'Default', 'Local Storage', 'leveldb', '000003.log'), 'local');
  写入测试文件(path.join(profileDir, 'Default', 'IndexedDB', 'demo.leveldb', 'CURRENT'), 'indexed');

  try {
    const 清理结果 = 清理浏览器资料目录可再生缓存(profileDir, {
      runtimeDir,
      backupRoot,
      时间: new Date(2026, 5, 30, 1, 2, 3),
    });

    assert.equal(清理结果.movedCount, 4);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Cache')), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Code Cache')), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'GrShaderCache')), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'BrowserMetrics-spare.pma')), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Network', 'Cookies')), true);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Local Storage', 'leveldb', '000003.log')), true);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'IndexedDB', 'demo.leveldb', 'CURRENT')), true);
    assert.equal(
      fs.existsSync(path.join(backupRoot, '浏览器缓存自动迁移', '20260630-010203', '京东2店', 'Default', 'Cache')),
      true,
    );
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test('浏览器缓存清理拒绝迁移 runtime 外部路径', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-profile-boundary-'));
  const runtimeDir = path.join(临时目录, 'runtime');
  const outsideProfileDir = path.join(临时目录, 'outside-profile');

  fs.mkdirSync(outsideProfileDir, { recursive: true });

  try {
    assert.throws(
      () => 清理浏览器资料目录可再生缓存(outsideProfileDir, { runtimeDir }),
      /缓存清理路径越界/,
    );
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test('收集浏览器资料目录会包含默认店铺和多店铺目录', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-profile-collect-'));
  const browserDir = path.join(临时目录, 'runtime', 'edge-profile');
  const storeProfilesDir = path.join(临时目录, 'runtime', 'store-profiles');

  fs.mkdirSync(path.join(storeProfilesDir, '京东2店'), { recursive: true });
  fs.mkdirSync(path.join(storeProfilesDir, '京东3店'), { recursive: true });

  try {
    const 资料目录列表 = 获取浏览器资料目录列表({
      browserDir,
      storeProfilesDir,
    });

    assert.deepEqual(资料目录列表.sort(), [
      browserDir,
      path.join(storeProfilesDir, '京东2店'),
      path.join(storeProfilesDir, '京东3店'),
    ].sort());
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test('浏览器启动参数会把磁盘缓存导向项目外缓存目录并限制体积', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-profile-cache-args-'));
  const profileDir = path.join(临时目录, 'runtime', 'edge-profile');
  const cacheRoot = path.join(临时目录, 'external-cache');

  try {
    const 参数列表 = 构建浏览器缓存启动参数(profileDir, { cacheRoot });
    const 磁盘缓存参数 = 参数列表.find((参数) => 参数.startsWith('--disk-cache-dir='));
    const 磁盘缓存目录 = 磁盘缓存参数.replace('--disk-cache-dir=', '');

    assert.equal(参数列表.includes('--disk-cache-size=104857600'), true);
    assert.equal(参数列表.includes('--media-cache-size=10485760'), true);
    assert.equal(磁盘缓存目录.startsWith(cacheRoot), true);
    assert.equal(fs.existsSync(磁盘缓存目录), true);
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test('运行目录超过总量阈值时会自动迁移缓存并记录处理前后体积', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-runtime-expansion-'));
  const runtimeDir = path.join(临时目录, 'runtime');
  const backupRoot = path.join(临时目录, 'backup');
  const profileDir = path.join(runtimeDir, 'store-profiles', '京东2店');

  写入测试文件(path.join(profileDir, 'Default', 'Cache', 'Cache_Data', 'data_3'), 'cache-content');
  写入测试文件(path.join(profileDir, 'Default', 'Network', 'Cookies'), 'cookie-content');

  try {
    const 处理结果 = 检查并处理运行目录膨胀({
      runtimeDir,
      backupRoot,
      maxRuntimeBytes: 1,
      时间: new Date(2026, 5, 30, 2, 3, 4),
      browserDir: path.join(runtimeDir, 'edge-profile'),
      storeProfilesDir: path.join(runtimeDir, 'store-profiles'),
    });

    assert.equal(处理结果.triggered, true);
    assert.equal(处理结果.cleanupResult.movedCount, 1);
    assert.equal(处理结果.beforeBytes > 处理结果.afterBytes, true);
    assert.match(处理结果.reason, /runtime=/);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Cache')), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Network', 'Cookies')), true);
    assert.equal(
      fs.existsSync(path.join(backupRoot, '浏览器缓存自动迁移', '20260630-020304', '京东2店', 'Default', 'Cache')),
      true,
    );
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test('单个店铺浏览器资料目录超过阈值时也会自动迁移缓存', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-profile-single-expansion-'));
  const runtimeDir = path.join(临时目录, 'runtime');
  const backupRoot = path.join(临时目录, 'backup');
  const profileDir = path.join(runtimeDir, 'store-profiles', '京东2店');

  写入测试文件(path.join(profileDir, 'Default', 'Cache', 'Cache_Data', 'data_3'), 'cache-content');
  写入测试文件(path.join(profileDir, 'Default', 'Network', 'Cookies'), 'cookie-content');

  try {
    const 处理结果 = 检查并处理运行目录膨胀({
      runtimeDir,
      backupRoot,
      maxRuntimeBytes: 1024 * 1024,
      maxProfileBytes: 1,
      时间: new Date(2026, 5, 30, 3, 4, 5),
      browserDir: path.join(runtimeDir, 'edge-profile'),
      storeProfilesDir: path.join(runtimeDir, 'store-profiles'),
    });

    assert.equal(处理结果.triggered, true);
    assert.equal(处理结果.oversizedProfiles.length, 1);
    assert.equal(处理结果.cleanupResult.movedCount, 1);
    assert.match(处理结果.reason, /京东2店=/);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Cache')), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Network', 'Cookies')), true);
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test('运行目录和单个资料目录都未超过阈值时不会执行缓存迁移', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-runtime-no-expansion-'));
  const runtimeDir = path.join(临时目录, 'runtime');
  const profileDir = path.join(runtimeDir, 'store-profiles', '京东2店');

  写入测试文件(path.join(profileDir, 'Default', 'Cache', 'Cache_Data', 'data_3'), 'cache-content');

  try {
    const 处理结果 = 检查并处理运行目录膨胀({
      runtimeDir,
      maxRuntimeBytes: 1024 * 1024,
      maxProfileBytes: 1024 * 1024,
      browserDir: path.join(runtimeDir, 'edge-profile'),
      storeProfilesDir: path.join(runtimeDir, 'store-profiles'),
    });

    assert.equal(处理结果.triggered, false);
    assert.equal(处理结果.cleanupResult, null);
    assert.equal(fs.existsSync(path.join(profileDir, 'Default', 'Cache')), true);
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test('运行目录最近已扫描时不会再次递归统计体积', () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-runtime-skip-scan-'));
  const runtimeDir = path.join(临时目录, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, '.browser-profile-guard.json'),
    JSON.stringify({ lastFullScanAt: '2026-07-01T00:00:00.000Z' }),
    'utf8',
  );

  try {
    const 处理结果 = 检查并处理运行目录膨胀({
      runtimeDir,
      时间: new Date('2026-07-01T01:00:00.000Z'),
      统计路径体积方法: () => {
        throw new Error('不应该执行递归统计');
      },
    });

    assert.equal(处理结果.triggered, false);
    assert.equal(处理结果.skipped, true);
    assert.match(处理结果.reason, /跳过递归统计/);
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});
