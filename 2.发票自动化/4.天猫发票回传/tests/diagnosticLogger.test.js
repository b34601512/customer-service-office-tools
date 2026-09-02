const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { 写入诊断日志, 重置诊断日志 } = require('../src/common/diagnosticLogger');

function 创建临时诊断日志路径() {
  // 该函数为诊断日志测试创建隔离路径，避免写入真实 runtime。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmall-diagnostic-'));
  return path.join(dir, 'latest-diagnostic.log');
}

test('诊断日志按统一格式写入文件', () => {
  const filePath = 创建临时诊断日志路径();
  重置诊断日志({ 文件路径: filePath, 允许测试写入: true });
  const line = 写入诊断日志('后台诊断', '测试模块', '测试子动作', {
    文件路径: filePath,
    允许测试写入: true,
  });

  const content = fs.readFileSync(filePath, 'utf8');
  assert.match(line, /\[主线:后台诊断\]\[测试模块\]\[测试子动作\]/);
  assert.match(content, /\[主线:后台诊断\]\[测试模块\]\[测试子动作\]/);
});

test('诊断日志重置会清空旧内容', () => {
  const filePath = 创建临时诊断日志路径();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'old', 'utf8');

  重置诊断日志({ 文件路径: filePath, 允许测试写入: true });

  assert.equal(fs.readFileSync(filePath, 'utf8'), '');
});
