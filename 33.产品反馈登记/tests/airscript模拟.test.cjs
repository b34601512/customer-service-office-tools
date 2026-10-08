// 33号 AirScript 本地模拟测试：node --test tests/airscript模拟.test.cjs
//
// 覆盖：
//  A. 粘贴安全（照 20号/30号 实测：不许 == != >= <=、不许箭头函数/模板字符串、末行顶层 return main()、语法可解析）；
//  B. 「产品问题」写入脚本行为：空表 probe；写表头三态（缺 allowWrite 不写 / 空表写+回读 0 差异 / 非空拒绝）；
//     写入守卫（缺 expectedLastRow 拒绝、末行不符拒绝、表头不一致拒绝、空表未建表头拒绝）；
//     happy path 追加 + 回读 0 差异 + 日期列设 '@'；第二批复用第一批末行；
//     dryRun 绝不写；毒错误（#N/A）不崩：表头单格读不到→拒绝，回读块读炸→逐格兜底。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const 脚本路径 = path.join(__dirname, '..', 'kdocs-scripts', 'AirScript-产品问题-写入.md');
const 全文 = fs.readFileSync(脚本路径, 'utf8');
const 去注释 = (text) => text.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');

// ---------- mock 金山运行时（Range；支持毒范围：读含毒格的任何范围都抛「一碰 message 就炸」的错误） ----------
function 造簿(初始格子, 毒集合) {
  const 格子 = { ...初始格子 };
  const 写日志 = [];
  const 格式日志 = [];
  const 列号 = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const 列名 = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  function 解析(addr) {
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(addr);
    if (!m) throw new Error('mock 无法解析范围: ' + addr);
    return { 列1: 列号(m[1]), 行1: Number(m[2]), 列2: m[3] ? 列号(m[3]) : 列号(m[1]), 行2: m[4] ? Number(m[4]) : Number(m[2]) };
  }
  const 毒错误 = () => {
    const o = {};
    Object.defineProperty(o, 'message', { get() { throw new Error('毒错误：不许碰 .message'); } });
    Object.defineProperty(o, 'toString', { get() { throw new Error('毒错误：不许碰 toString'); } });
    return o;
  };
  const 有毒 = (r) => [...(毒集合 || [])].some((a) => {
    const x = 解析(a);
    return x.行1 <= r.行2 && r.行1 <= x.行2 && x.列1 <= r.列2 && r.列1 <= x.列2;
  });
  function 范围(addr) {
    const r = 解析(addr);
    return {
      get Value2() {
        if (有毒(r)) throw 毒错误();
        if (r.行1 === r.行2 && r.列1 === r.列2) return 格子[addr] === undefined ? '' : 格子[addr];
        const 出 = [];
        for (let 行 = r.行1; 行 <= r.行2; 行 += 1) {
          const 行值 = [];
          for (let c = r.列1; c <= r.列2; c += 1) 行值.push(格子[列名(c) + 行] === undefined ? '' : 格子[列名(c) + 行]);
          出.push(行值);
        }
        return 出;
      },
      set Value2(值) {
        if (r.行1 === r.行2 && r.列1 === r.列2) { 格子[addr] = 值; 写日志.push({ 地址: addr, 值 }); return; }
        const 行列表 = Array.isArray(值) ? (Array.isArray(值[0]) ? 值 : [值]) : [[值]];
        行列表.forEach((行值, i) => {
          (Array.isArray(行值) ? 行值 : [行值]).forEach((v, j) => {
            const a = 列名(r.列1 + j) + (r.行1 + i);
            格子[a] = v;
            写日志.push({ 地址: a, 值: v });
          });
        });
      },
      get Text() {
        if (有毒(r)) throw 毒错误();
        const v = 格子[addr];
        return v === undefined || v === null ? '' : String(v);
      },
      set NumberFormatLocal(f) { 格式日志.push({ 范围: addr, 格式: f }); },
      set NumberFormat(f) { 格式日志.push({ 范围: addr, 格式: f }); }
    };
  }
  const 表 = { Range: 范围 };
  return { 格子: () => 格子, 写日志: () => 写日志, 格式日志: () => 格式日志, Application: { Worksheets: { Item: () => 表 } } };
}

function 跑(argv, 初始格子, 毒集合) {
  const 簿 = 造簿(初始格子 || {}, 毒集合);
  const 函数体 = new Function('Context', 'Application', 全文);
  return { 结果: 函数体({ argv }, 簿.Application), 簿 };
}

const 头格 = () => ({
  A1: '登记日期', B1: '反馈人', C1: '产品型号', D1: '问题描述', E1: '反馈对象',
  F1: '反馈日期', G1: '处理进度', H1: '处理结果', I1: '备注'
});
const 行1 = ['2026/10/8', '黎路遥', '湿化瓶', '白色管子接侧面，用户接制氧机出氧口会喷水', '产品部', '2026/10/8', '已反馈，待产品部处理', '', '诉求：工厂调整流程，管子接顶部'];

// ================= A. 粘贴安全 =================
test('粘贴安全：无 == != >= <=、无箭头函数/模板字符串、末行 return main()、语法可解析', () => {
  const 代码 = 去注释(全文);
  for (const tok of ['==', '!=', '>=', '<=']) assert.ok(!代码.includes(tok), `不许出现 ${tok}`);
  assert.ok(!全文.includes('=>'), '不许用箭头函数');
  assert.ok(!全文.includes('`'), '不许用模板字符串');
  const 行 = 全文.trim().split(/\r?\n/);
  assert.equal(行[行.length - 1], 'return main()');
  assert.doesNotThrow(() => new Function('Context', 'Application', 全文));
});

// ================= B. 行为 =================
test('probe：空表 → headerOk=false、headerEmpty=true、lastRow=0', () => {
  const { 结果, 簿 } = 跑({ probe: true });
  assert.equal(结果.mode, 'probe');
  assert.equal(结果.headerOk, false);
  assert.equal(结果.headerEmpty, true);
  assert.equal(结果.lastRow, 0);
  assert.equal(结果.dataRows, 0);
  assert.equal(簿.写日志().length, 0);
});

test('写表头：缺 allowWrite → 拒绝且不写', () => {
  const { 结果, 簿 } = 跑({ 写表头: true });
  assert.equal(结果.written, false);
  assert.equal(簿.写日志().length, 0);
  assert.equal(簿.格子().A1, undefined);
});

test('写表头：空表 + allowWrite → 写入 9 列表头，回读 0 差异', () => {
  const { 结果, 簿 } = 跑({ 写表头: true, allowWrite: true });
  assert.equal(结果.written, true);
  assert.equal(结果.回读差异数, 0);
  assert.equal(簿.格子().A1, '登记日期');
  assert.equal(簿.格子().I1, '备注');
  const 探 = 跑({ probe: true }, 簿.格子()).结果;
  assert.equal(探.headerOk, true);
  assert.equal(探.headerEmpty, false);
});

test('写表头：表头行非空 → 拒绝且不改动', () => {
  const { 结果, 簿 } = 跑({ 写表头: true, allowWrite: true }, { A1: '别人写的', B1: '东西' });
  assert.equal(结果.written, false);
  assert.equal(簿.格子().A1, '别人写的');
  assert.ok(结果.message.includes('不是空'));
});

test('写入：缺 expectedLastRow → 拒绝（防重复必带）', () => {
  const { 结果, 簿 } = 跑({ rows: [行1], allowWrite: true }, 头格());
  assert.equal(结果.written, false);
  assert.ok(结果.message.includes('expectedLastRow'));
  assert.equal(簿.写日志().length, 0);
});

test('写入：expectedLastRow 与实际末行不符 → 拒绝', () => {
  const 初始 = { ...头格(), A2: '2026/10/8', B2: '前人' };
  const { 结果, 簿 } = 跑({ rows: [行1], expectedLastRow: 0, allowWrite: true }, 初始);
  assert.equal(结果.written, false);
  assert.ok(结果.message.includes('不一致'));
  assert.equal(簿.写日志().length, 0);
});

test('写入：表头被改过 → 拒绝（防表结构变了误伤）', () => {
  const 初始 = { ...头格(), D1: '被改过的列名' };
  const { 结果, 簿 } = 跑({ rows: [行1], expectedLastRow: 0, allowWrite: true }, 初始);
  assert.equal(结果.written, false);
  assert.ok(结果.message.includes('不一致'));
  assert.equal(簿.写日志().length, 0);
});

test('写入：空表未建表头 → 拒绝并提示先写表头', () => {
  const { 结果 } = 跑({ rows: [行1], expectedLastRow: 0, allowWrite: true }, {});
  assert.equal(结果.written, false);
  assert.ok(结果.message.includes('写表头'));
});

test('写入 happy path：第 2 行起追加，回读 0 差异，日期列设 @', () => {
  const { 结果, 簿 } = 跑({ rows: [行1], expectedLastRow: 0, allowWrite: true }, 头格());
  assert.equal(结果.written, true);
  assert.equal(结果.mismatchedRows, 0);
  assert.equal(结果.firstRow, 2);
  assert.equal(结果.末行, 2);
  assert.equal(簿.格子().A2, '2026/10/8');
  assert.equal(簿.格子().D2, 行1[3]);
  assert.equal(簿.格子().I2, 行1[8]);
  const 文本列格 = 簿.格式日志().filter((x) => x.格式 === '@').map((x) => x.范围);
  assert.ok(文本列格.includes('A2:A2'), 'A 列要设文本格式');
  assert.ok(文本列格.includes('F2:F2'), 'F 列要设文本格式');
});

test('写入第二批复用第一批末行 → 落第 3 行', () => {
  const 初始 = { ...头格(), A2: '2026/10/8', B2: '前人', C2: 'x', D2: 'x', E2: 'x', F2: '2026/10/8', G2: 'x', H2: '', I2: '' };
  const 行2 = ['2026/10/9', '张三', '湿化瓶', '第二条问题', '产品部', '2026/10/9', '已反馈', '', ''];
  const { 结果, 簿 } = 跑({ rows: [行2], expectedLastRow: 2, allowWrite: true }, 初始);
  assert.equal(结果.written, true);
  assert.equal(结果.firstRow, 3);
  assert.equal(结果.mismatchedRows, 0);
  assert.equal(簿.格子().A3, '2026/10/9');
});

test('dryRun：只检查不写，通过且写日志为空', () => {
  const { 结果, 簿 } = 跑({ dryRun: true, rows: [行1], expectedLastRow: 0 }, 头格());
  assert.equal(结果.mode, 'dryRun');
  assert.equal(结果.通过, true);
  assert.equal(结果.将写起始行, 2);
  assert.equal(簿.写日志().length, 0);
});

test('毒错误回归：表头格读不到 → 写表头拒绝、脚本不崩', () => {
  const { 结果, 簿 } = 跑({ 写表头: true, allowWrite: true }, {}, ['C1']);
  assert.equal(结果.表头读不到数, 1);
  assert.equal(结果.written, false);
  assert.equal(簿.写日志().length, 0);
});

test('毒错误回归：回读块读炸 → 自动逐格兜底，如实报差异、脚本不崩', () => {
  const { 结果 } = 跑({ rows: [行1], expectedLastRow: 0, allowWrite: true }, { ...头格(), B2: '占位' }, ['B2']);
  assert.equal(结果.written, true);
  assert.equal(结果.回读兜底, true);
  assert.ok(结果.mismatchedRows >= 1, '读不到的格要计入差异');
  assert.ok(结果.firstMismatch.includes('读不到'));
});

test('main 兜底：没带任何动作 → 走写入检查并拒绝（rows 为空）', () => {
  const { 结果, 簿 } = 跑({}, 头格());
  assert.equal(结果.written, false);
  assert.ok(结果.message.includes('rows 是空的'));
  assert.equal(簿.写日志().length, 0);
});
