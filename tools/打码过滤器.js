#!/usr/bin/env node
/**
 * 打码过滤器（Git clean/smudge 驱动，给 `.gitattributes` 的 `filter=打码` 用）
 *
 *   git 配置（一次性，本机）：
 *     git config filter.打码.clean  "node tools/打码过滤器.js clean"
 *     git config filter.打码.smudge "node tools/打码过滤器.js smudge"
 *
 *   clean  ：提交时把「真值 → 打码值」（GitHub 上看到的是打码值）
 *   smudge ：检出时把「打码值 → 真值」（本机文件保持真值，工具照常能用）
 *
 * 对照表在 `tools/打码对照.local`（本机私有，不入库）。真值由 `node tools/打码.js --学` 收进来。
 */
const { 读对照, 替换 } = require('./打码字典');

function 读stdin() {
  return new Promise((resolve) => {
    let 数据 = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { 数据 += d; });
    process.stdin.on('end', () => resolve(数据));
  });
}

(async () => {
  const 模式 = process.argv[2];
  const 表 = 读对照();
  const 输入 = await 读stdin();
  if (模式 !== 'clean' && 模式 !== 'smudge') {
    process.stderr.write('用法：node tools/打码过滤器.js clean|smudge（内容从 stdin 读）\n');
    process.exit(2);
  }
  process.stdout.write(替换(输入, 模式 === 'clean' ? '打码' : '还原', 表));
})();
