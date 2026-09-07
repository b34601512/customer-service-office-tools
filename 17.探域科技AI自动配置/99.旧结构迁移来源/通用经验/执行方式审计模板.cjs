// 意图：审计指定脚本目录是否误用有头GUI，并核对可选意图索引。
// 范围：调用者传入的目录和索引文件；只读，不访问后台。
// 读写级别：只读；验证：禁止模式和缺失索引；恢复：无外部副作用。
const fs = require('fs');
const path = require('path');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const directory = path.resolve(arg('directory') || '.');
const indexFile = arg('index-file');
const forbidden = [/headless\s*:\s*false/i, /--headless(?:=|\s+)false/i, /--start-maximized/i, /pyautogui|selenium/i];
const files = fs.readdirSync(directory).filter(name => /\.(?:cjs|js|ts|py)$/i.test(name));
const violations = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(directory, file), 'utf8');
  for (const pattern of forbidden) if (pattern.test(text)) violations.push({ file, pattern: pattern.source });
}
let missingIntent = [];
if (indexFile) {
  const index = JSON.parse(fs.readFileSync(path.resolve(indexFile), 'utf8'));
  const indexed = new Set(Object.keys(index.scripts || index));
  missingIntent = files.filter(file => !indexed.has(file));
}
const result = { directory, scanned: files.length, violations, indexed: Boolean(indexFile), missingIntent };
console.log(JSON.stringify(result, null, 2));
process.exitCode = violations.length || missingIntent.length ? 1 : 0;
