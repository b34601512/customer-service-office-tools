// 配置读写（纯业务）：真值存 runtime/config/config.json（不入库），
// 首次运行从 config.example.json 复制默认。
const fs = require('fs');

const DEFAULT_CDP = {
  port: 9222,
  pageTitleMatch: '京东客服管家',
  apiBase: 'https://kf.jd.com/chatLog/queryList.action',
  pageSize: 50
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const key of Object.keys(extra || {})) {
    const b = base[key];
    const e = extra[key];
    if (b && e && typeof b === 'object' && !Array.isArray(b) && !Array.isArray(e)) {
      out[key] = deepMerge(b, e);
    } else if (e !== undefined) {
      out[key] = e;
    }
  }
  return out;
}

/** 读取配置；缺失时用 example 模板建默认并落盘。返回 {cdp}。 */
function loadConfig(ws) {
  ws.ensure();
  const file = ws.configFile();
  let cfg = null;
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`配置文件损坏 ${file}: ${e.message}`);
    }
  } else {
    const example = ws.exampleConfigFile();
    let exampleCfg = { cdp: DEFAULT_CDP };
    if (fs.existsSync(example)) {
      try {
        exampleCfg = JSON.parse(fs.readFileSync(example, 'utf8'));
      } catch (e) {
        throw new Error(`config.example.json 损坏: ${e.message}`);
      }
    }
    cfg = exampleCfg;
    saveConfig(ws, cfg);
  }
  cfg.cdp = deepMerge(DEFAULT_CDP, cfg.cdp);
  return cfg;
}

function saveConfig(ws, cfg) {
  ws.ensure();
  fs.writeFileSync(ws.configFile(), JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { loadConfig, saveConfig, DEFAULT_CDP };
