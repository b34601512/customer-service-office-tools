const fs = require('fs');
const file = 'D:/桌面/办公软件/17.探域科技AI自动配置/德达医疗公司专属资料/待确认-Agent售前缺氧承接草案-20260908.md';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const body = fs.readFileSync(file, 'utf8').split(/## 禁止表达|## 明确禁止/)[0].split(/\r?\n/).filter(line => !line.includes('不得')).join('\n');
const checks = {
  场景承接: /使用场景/.test(body),
  医嘱核对: /医生建议|处方/.test(body),
  疾病筛查: /疾病名称只用于/.test(body),
  急症分流: /急救/.test(body),
  商品筛选: /噪声、便携性、预算/.test(body),
  无正向参数映射: !/(血氧|医院.{0,12}档位).{0,20}(直接|换算|升数)/i.test(body)
};
console.log(JSON.stringify({ checks, passed: Object.values(checks).every(Boolean) }, null, 2));
if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
