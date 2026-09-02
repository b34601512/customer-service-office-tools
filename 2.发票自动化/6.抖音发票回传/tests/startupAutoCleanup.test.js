const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { 构建启动清理路径列表, 执行启动自动清理 } = require('../src/common/runtimeCleanup/startupAutoCleanup');

function 创建临时项目目录() {
  // 该函数为启动清理测试创建隔离项目目录，避免触碰真实 runtime。
  return fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-runtime-cleanup-'));
}

test('启动清理路径不包含登录资料和旧控制台目录', () => {
  const projectRoot = path.join(os.tmpdir(), 'douyin-project');
  const paths = 构建启动清理路径列表(projectRoot);

  assert.equal(paths.some((item) => item.includes(path.join('runtime', 'store-profiles'))), false);
  assert.equal(paths.some((item) => item.includes(path.join('runtime', 'douyin-exports'))), true);
  assert.equal(paths.some((item) => item.includes(path.join('runtime', 'control-center-window'))), false);
});

test('启动清理会迁移临时产物但保留店铺资料', async () => {
  const projectRoot = 创建临时项目目录();
  const backupRoot = path.join(projectRoot, 'backup');
  const screenshotsDir = path.join(projectRoot, 'runtime', 'screenshots');
  const profileDir = path.join(projectRoot, 'runtime', 'store-profiles', 'msedge', 'store-a');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(screenshotsDir, 'old.png'), 'image', 'utf8');
  fs.writeFileSync(path.join(profileDir, 'state'), 'keep', 'utf8');

  const result = await 执行启动自动清理({
    projectRoot,
    备份根目录: backupRoot,
    now: new Date('2026-07-03T08:09:10'),
  });

  assert.equal(fs.existsSync(screenshotsDir), false);
  assert.equal(fs.existsSync(profileDir), true);
  assert.equal(result.length, 1);
  assert.match(result[0].备份路径, /抖音发票回传-runtime缓存备份/);
});
