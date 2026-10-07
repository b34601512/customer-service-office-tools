// 30号 AirScript「京东仓退货数据-写入」本地模拟测试（node --test tests/airscript模拟.test.cjs）
//
// 覆盖两层：
//  A. 粘贴安全规则（照 20号/22号 实测结论：不许双字符比较、末行顶层 return main()、本地语法可解析、无箭头函数/模板字符串）；
//  B. 写入正确性——**行形态三种到达方式**：真数组 / "a,b,c" 字符串 / 类数组对象。
//     2026-10-07 背景：首次云端导入把整行挤进 A 列（argv 的行不是 JS 数组，旧代码 instanceof 判空后
//     整行 String() 成 "单号,运单,状态"）→ 这里把三种形态都锁死（反向断言），以后改回去就会红。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const 脚本路径 = path.join(__dirname, '..', 'kdocs-scripts', 'AirScript-京东仓退货数据-写入.md');
const 脚本全文 = fs.readFileSync(脚本路径, 'utf8');
const 去注释 = (text) => text.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');

// ---------- mock 金山表格运行时 ----------
function 造工作簿(初始格子, 选项) {
  const 坏写入 = Boolean((选项 || {}).坏写入); // 模拟旧故障：整片写入时把整行 String() 挤进 A 列
  const 格子 = { ...初始格子 };
  const 列号 = (s) => s.charCodeAt(0) - 64;
  const 列名 = (n) => String.fromCharCode(64 + n);
  function 解析(addr) {
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(addr);
    if (!m) throw new Error('mock 无法解析范围: ' + addr);
    return { 列1: m[1], 行1: Number(m[2]), 列2: m[3] || m[1], 行2: m[4] ? Number(m[4]) : Number(m[2]) };
  }
  function 范围(addr) {
    const r = 解析(addr);
    const 每行每列 = (fn) => {
      for (let 行 = r.行1; 行 <= r.行2; 行 += 1)
        for (let c = 列号(r.列1); c <= 列号(r.列2); c += 1) fn(列名(c) + 行, c - 列号(r.列1), 行 - r.行1);
    };
    return {
      get Value2() {
        const 行数组 = [];
        for (let 行 = r.行1; 行 <= r.行2; 行 += 1) {
          const 行值 = [];
          for (let c = 列号(r.列1); c <= 列号(r.列2); c += 1) 行值.push(格子[列名(c) + 行] ?? '');
          行数组.push(行值);
        }
        if (r.行1 === r.行2 && r.列1 === r.列2) return 行数组[0][0];
        return 行数组;
      },
      set Value2(值) {
        if (Array.isArray(值)) {
          if (坏写入) {
            值.forEach((行, i) => { 格子['A' + (r.行1 + i)] = Array.isArray(行) ? 行.join(',') : String(行); });
            return;
          }
          值.forEach((行, i) => {
            const 行数组 = Array.isArray(行) ? 行 : [行];
            行数组.forEach((v, j) => { 格子[列名(列号(r.列1) + j) + (r.行1 + i)] = v; });
          });
          return;
        }
        每行每列((a) => { 格子[a] = 值; });
      },
      ClearContents() { 每行每列((a) => { delete 格子[a]; }); },
      set NumberFormatLocal(_) {}, set NumberFormat(_) {}
    };
  }
  const 表 = { Range: 范围 };
  return {
    格子: () => 格子,
    Application: { Worksheets: { Item: (名) => 表 } }
  };
}

function 跑(argv, 初始格子, 选项) {
  const 簿 = 造工作簿(初始格子, 选项);
  const 函数体 = new Function('Context', 'Application', 脚本全文); // 顶层 return main() 在 Function 体内合法
  return { 结果: 函数体({ argv }, 簿.Application), 格子: 簿.格子() };
}

const 表头 = { A1: '销售平台单号', B1: '逆向运单号', C1: '是否退回' };
const 两行 = [['3554444002837099', 'JDVA45669076392', '已退回京东仓'], ['3562470004213146', 'JDVC37315833034', '已退回京东仓']];

// ---------- A. 粘贴安全规则 ----------
test('粘贴安全：不许双字符比较（== != >= <= 会被粘贴通道吃掉）', () => {
  const 违规 = 去注释(脚本全文).split(/\r?\n/).map((line, i) => ({ line: line.trim(), n: i + 1 })).filter((x) => /[=!<>]=/.test(x.line));
  assert.deepEqual(违规, []);
});
test('粘贴安全：末行顶层 return main()、无箭头函数/模板字符串、本地语法可解析', () => {
  const 行 = 去注释(脚本全文).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.equal(行[行.length - 1], 'return main()');
  const 代码 = 去注释(脚本全文);
  assert.ok(!代码.includes('=>'), '不许用箭头函数');
  assert.ok(!代码.includes('`'), '不许用模板字符串');
  assert.doesNotThrow(() => new vm.Script(脚本全文.replace(/^return main\(\)$/m, 'main()')));
});

// ---------- B. 探针 ----------
test('探针：报版本/表头/现有行数；带样本 rows 时报「行形态」', () => {
  const 初始 = { ...表头, A2: '旧单号', B2: '旧运单', C2: '已退回京东仓' };
  const 裸 = 跑({ probe: true }, 初始);
  assert.equal(裸.结果.mode, 'probe');
  assert.equal(裸.结果.headerOk, true);
  assert.equal(裸.结果.dataRows, 1);
  assert.equal(裸.结果.行形态, '未提供');
  const 带 = 跑({ probe: true, rows: 两行 }, 初始);
  assert.match(带.结果.行形态, /是JS数组:是/);
  assert.equal(带.结果.dataRows, 1, '探针不许写数据');
});

// ---------- C. 写入：三种行形态都要正确 ----------
for (const [形态名, 行数据] of [
  ['真数组', 两行],
  ['字符串行（"a,b,c"）', 两行.map((r) => r.join(','))],
  ['类数组对象', 两行.map((r) => ({ 0: r[0], 1: r[1], 2: r[2], length: 3 }))]
]) {
  test(`写入正确性：${形态名} → 3 列各就各位、旧行清干净、mismatchedRows=0`, () => {
    const 初始 = { ...表头, A2: '旧单号1', B2: '旧运单1', C2: '已退回京东仓', A3: '旧单号2', B3: '旧运单2', C3: '已退回京东仓' };
    const { 结果, 格子 } = 跑({ rows: 行数据, allowWrite: true }, 初始);
    assert.equal(结果.written, true, JSON.stringify(结果));
    assert.equal(结果.mismatchedRows, 0, `首条差异：${结果.firstMismatch}`);
    assert.equal(格子.A2, '3554444002837099');
    assert.equal(格子.B2, 'JDVA45669076392');
    assert.equal(格子.C2, '已退回京东仓');
    assert.equal(格子.A3, '3562470004213146');
    assert.equal(格子.B3, 'JDVC37315833034');
    assert.equal(格子.A4, undefined, '旧数据行要清掉');
    assert.equal(格子.A1, '销售平台单号', '表头不许动');
  });
}

// ---------- D. 坏写入要被「回读比对」抓住（本次故障的探测器） ----------
test('坏写入检测：整行挤进 A 列时 mismatchedRows>0 且给出首条差异', () => {
  const { 结果 } = 跑({ rows: 两行, allowWrite: true }, { ...表头 }, { 坏写入: true });
  assert.equal(结果.written, true);
  assert.ok(结果.mismatchedRows > 0, '内容错必须报出来');
  assert.match(结果.firstMismatch, /期望\[/);
});

// ---------- E. 安全闸门 ----------
test('安全闸门：无 allowWrite / rows 为空 / 表头不对 → 都拒写', () => {
  const 初始 = { ...表头, A2: '旧单号' };
  const 无授权 = 跑({ rows: 两行 }, 初始);
  assert.equal(无授权.结果.written, false);
  assert.equal(无授权.格子.A2, '旧单号');
  const 空行 = 跑({ rows: [], allowWrite: true }, 初始);
  assert.equal(空行.结果.written, false);
  assert.equal(空行.格子.A2, '旧单号');
  const 坏表头 = 跑({ rows: 两行, allowWrite: true }, { A1: '别的表', A2: '旧单号' });
  assert.equal(坏表头.结果.written, false);
  assert.equal(坏表头.格子.A2, '旧单号');
});
