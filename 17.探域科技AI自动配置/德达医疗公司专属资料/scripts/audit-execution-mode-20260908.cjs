// 意图：审计当前脚本是否误用有头GUI，并核对核心脚本意图索引。
// 范围：本目录*.cjs；只读，不访问后台、不写配置。
// 验证：扫描禁止模式；退出码0表示通过，非0表示需人工处理。
// 恢复：无外部副作用。
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const index = JSON.parse(fs.readFileSync(path.join(dir, 'intent-index-20260908.json'), 'utf8'));
const forbidden = [
  /headless\s*:\s*false/i, /--headless(?:=|\s+)false/i, /--start-maximized/i,
  /pyautogui|selenium/i
];
const files = fs.readdirSync(dir).filter(x => x.endsWith('.cjs') && x !== path.basename(__filename));
const violations = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const re of forbidden) if (re.test(text)) violations.push({ file, pattern: re.source });
}
const missingIntent = Object.keys(index.scripts).filter(file => !files.includes(file));
const result = { scanned: files.length, violations, indexedCoreScripts: Object.keys(index.scripts).length, missingIntent };
console.log(JSON.stringify(result, null, 2));
process.exitCode = violations.length || missingIntent.length ? 1 : 0;
