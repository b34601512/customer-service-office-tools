// 工作区路径（纯业务：不涉及任何 UI）
// 默认工作区 = 本工具目录；测试与未来 AI 无界面运行可传入 base 隔离目录。
const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');

/** 去除文件名非法字符，空则给默认名 */
function sanitize(name) {
  const clean = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .trim();
  return clean || '会话';
}

/** '2026-08-05' -> '2026年8月'（与历史成品目录命名一致） */
function monthDirOf(window) {
  const m = String(window || '').match(/^(\d{4})-(\d{1,2})/);
  return m ? `${m[1]}年${Number(m[2])}月` : '';
}

function createWorkspace(base = DEFAULT_ROOT) {
  const dirs = {
    root: base,
    chat: path.join(base, 'runtime', 'chat'),     // 标准聊天记录 JSON
    review: path.join(base, 'runtime', 'review'), // AI 解析数据 JSON
    outputs: path.join(base, 'runtime', 'outputs'), // 成品 HTML
    config: path.join(base, 'runtime', 'config'), // 真值配置（不入库）
    logs: path.join(base, 'runtime', 'logs')
  };
  const configFile = () => path.join(dirs.config, 'config.json');
  const exampleConfigFile = () => path.join(base, 'config.example.json');

  function ensure() {
    Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
    return true;
  }

  function listJson(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  }

  function baseNameOf(file) {
    return path.basename(file).replace(/\.(chat|review)\.json$/i, '');
  }

  return { dirs, ensure, configFile, exampleConfigFile, listJson, baseNameOf, sanitize };
}

module.exports = { createWorkspace, sanitize, monthDirOf, DEFAULT_ROOT };
