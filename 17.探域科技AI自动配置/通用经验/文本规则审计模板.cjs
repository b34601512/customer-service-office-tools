// 意图：对调用者提供的文本执行可配置规则审计，输出命中位置和内容摘要。
// 范围：本地输入文件与规则文件；不访问后台、不写入业务配置。
// 读写级别：只读；验证：输入SHA、规则数量、命中项；恢复：无外部副作用。
const fs = require('fs');
const crypto = require('crypto');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
const required = name => { const value = arg(name); if (!value) throw new Error(`缺少参数 --${name}`); return value; };
const sha = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const inputFile = required('input-file');
const rulesFile = required('rules-file');
const text = fs.readFileSync(inputFile, 'utf8');
const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
if (!Array.isArray(rules) || rules.some(rule => !rule?.name || !rule?.pattern)) throw new Error('规则文件必须是含name和pattern的数组');
const findings = [];
for (const rule of rules) {
  const flags = rule.flags || 'gi';
  const regex = new RegExp(rule.pattern, flags.includes('g') ? flags : flags + 'g');
  for (const match of text.matchAll(regex)) findings.push({ name: rule.name, index: match.index, excerpt: text.slice(Math.max(0, match.index - 80), Math.min(text.length, match.index + match[0].length + 160)) });
}
const result = { inputFile, inputSha256: sha(text), inputLength: text.length, ruleCount: rules.length, findingCount: findings.length, findings };
console.log(JSON.stringify(result, null, 2));
if (arg('fail-on-findings') === 'true' && findings.length) process.exitCode = 2;
