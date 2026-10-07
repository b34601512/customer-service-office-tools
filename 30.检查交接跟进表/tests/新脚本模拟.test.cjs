// 30号 新脚本本地模拟测试：K列清洗 + 勾选已完结（node --test tests/新脚本模拟.test.cjs）
//
// 覆盖：
//  A. 粘贴安全规则（照 20号/22号 实测结论：不许成双等号、末行顶层 return main()、本地语法可解析、无箭头函数/模板字符串）；
//  B. K列清洗：去空白、空与 / - — 跳过、公式格跳过、dryRun 不写、allowWrite 只写有变化的格、其它列不碰、回读 mismatched=0；
//  C. 勾选已完结（v2026-10-07.4 单元格复选框版）：
//     F 格 = 数字 1/0（勾/未勾）；catch 绝不碰错误对象（毒错误回归测试——2026-10-07 实测崩溃根因）；
//     试 模式各测；自检候选（渠道状态 ∩ F 未勾）；指定行候选（复核）；allowWrite 只写候选、只勾不取消、回读 0 不符；
//     表头不对拒绝动手。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const K路径 = path.join(__dirname, '..', 'kdocs-scripts', 'AirScript-湖南对接表K列清洗.md');
const 勾选路径 = path.join(__dirname, '..', 'kdocs-scripts', 'AirScript-交接表勾选已完结.md');
const K全文 = fs.readFileSync(K路径, 'utf8');
const 勾选全文 = fs.readFileSync(勾选路径, 'utf8');
const 去注释 = (text) => text.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');

// ---------- mock 金山表格运行时（Range；记录写日志；支持毒错误范围模拟引擎读崩） ----------
// 毒范围：读这些范围时抛一个「message 取值就二次抛错」的错误对象 —— 脚本的 catch 若不碰错误对象就能活下来。
function 造簿(初始格子, 公式格, 毒范围) {
  const 格子 = { ...初始格子 };
  const 公式 = new Set(公式格 || []);
  const 毒 = new Set(毒范围 || []);
  const 写日志 = [];
  const 格式日志 = [];
  const 列号 = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const 列名 = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  function 解析(addr) {
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(addr);
    if (!m) throw new Error('mock 无法解析范围: ' + addr);
    return { 列1: m[1], 行1: Number(m[2]), 列2: m[3] || m[1], 行2: m[4] ? Number(m[4]) : Number(m[2]) };
  }
  const 毒错误 = () => {
    const o = {};
    Object.defineProperty(o, 'message', { get() { throw new Error('毒错误：不许碰 .message'); } });
    Object.defineProperty(o, 'toString', { get() { throw new Error('毒错误：不许碰 toString'); } });
    return o;
  };
  const 显示文本 = (v) => (v === 1 ? '☑' : v === 0 ? '☐' : v === undefined || v === null ? '' : String(v));
  function 范围(addr) {
    const r = 解析(addr);
    const 单格 = (r.行1 === r.行2 && r.列1 === r.列2);
    const 遍历 = (fn) => {
      for (let 行 = r.行1; 行 <= r.行2; 行 += 1)
        for (let c = 列号(r.列1); c <= 列号(r.列2); c += 1) fn(列名(c) + 行);
    };
    return {
      get Value2() {
        if (毒.has(addr)) throw 毒错误();
        if (单格) return 格子[addr] ?? '';
        const 行数组 = [];
        for (let 行 = r.行1; 行 <= r.行2; 行 += 1) {
          const 行值 = [];
          for (let c = 列号(r.列1); c <= 列号(r.列2); c += 1) 行值.push(格子[列名(c) + 行] ?? '');
          行数组.push(行值);
        }
        return 行数组;
      },
      set Value2(值) {
        if (单格) { 格子[addr] = 值; 写日志.push({ 地址: addr, 值 }); return; }
        if (Array.isArray(值)) {
          值.forEach((行, i) => {
            const 行数组 = Array.isArray(行) ? 行 : [行];
            行数组.forEach((v, j) => { const a = 列名(列号(r.列1) + j) + (r.行1 + i); 格子[a] = v; 写日志.push({ 地址: a, 值: v }); });
          });
          return;
        }
        遍历((a) => { 格子[a] = 值; 写日志.push({ 地址: a, 值 }); });
      },
      get Text() {
        if (毒.has(addr)) throw 毒错误();
        return 显示文本(格子[addr]);
      },
      get HasFormula() { return 单格 ? 公式.has(addr) : false; },
      set NumberFormatLocal(值) { if (单格) 格式日志.push({ 地址: addr, 格式: 值 }); },
      set NumberFormat(值) { if (单格) 格式日志.push({ 地址: addr, 格式: 值 }); },
      ClearContents() { 遍历((a) => { delete 格子[a]; }); }
    };
  }
  const 表 = { Range: 范围 };
  return {
    格子: () => 格子,
    写日志: () => 写日志,
    格式日志: () => 格式日志,
    Application: { Worksheets: { Item: (_名) => 表 } }
  };
}

function 跑(全文, argv, 初始格子, 公式格, 毒范围) {
  const 簿 = 造簿(初始格子, 公式格, 毒范围);
  const 函数体 = new Function('Context', 'Application', 全文); // 顶层 return main() 在 Function 体内合法
  return { 结果: 函数体({ argv }, 簿.Application), 簿 };
}

// ================= A. 粘贴安全 =================
for (const [名, 全文] of [['K列清洗', K全文], ['勾选已完结', 勾选全文]]) {
  test(`粘贴安全(${名})：无 == != >= <=、无箭头函数/模板字符串、末行 return main()、语法可解析`, () => {
    const 代码 = 去注释(全文);
    const 违规 = 代码.split(/\r?\n/).map((line, i) => ({ line: line.trim(), n: i + 1 })).filter((x) => /[=!<>]=/.test(x.line));
    assert.deepEqual(违规, []);
    const 行 = 代码.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    assert.equal(行[行.length - 1], 'return main()');
    assert.ok(!代码.includes('=>'), '不许用箭头函数');
    assert.ok(!代码.includes('`'), '不许用模板字符串');
    assert.doesNotThrow(() => new vm.Script(全文.replace(/^return main\(\)$/m, 'main()')));
  });
}

// ================= B. K列清洗 =================
const K表头 = { K1: '订单号', A2: '序号一号', L2: '别碰我 ' };
const K初始 = {
  ...K表头,
  K2: ' 3620414009188506',          // 前空格
  K3: '3620414009188506 ',          // 尾空格
  K4: '362 0414\u3000009188506',    // 中间半角+全角空格
  K5: '\t3620414009188506\r\n',     // TAB + 换行
  K6: 'E20260329225342071400041',   // 干净，不该被写
  K7: '/',                          // 非单号，跳过
  K8: '   ',                        // 全空白，跳过（不许清空）
  K9: ' 3620414009188506',          // 公式格，跳过
  K10: '- ',                        // 洗成 -，跳过
  K11: '',                          // 空
  K12: '\u200b3620414009188506\ufeff' // 零宽 + BOM
};

test('K清洗·dryRun：不写任何格，只回将改动清单', () => {
  const { 结果, 簿 } = 跑(K全文, { dryRun: true }, K初始);
  assert.equal(结果.wrote, false);
  assert.equal(结果.mode, 'dryRun');
  assert.equal(结果.headerOk, true);
  assert.equal(簿.写日志().length, 0);
  assert.equal(结果.changed, 6, JSON.stringify(结果.samples));
  assert.equal(结果.samples.length, 6);
  assert.equal(结果.skippedSlash, 2, 'K7 与 K10');
  assert.equal(结果.skippedBlank, 1, 'K8');
  assert.equal(结果.samples[0].行, 2);
  assert.equal(结果.samples[0].原值, ' 3620414009188506');
  assert.equal(结果.samples[0].新值, '3620414009188506');
  assert.equal(结果.samples[0].原值可见, '[半角空格]3620414009188506');
});

test('K清洗·probe：报版本/表头/行数，不写', () => {
  const { 结果, 簿 } = 跑(K全文, { probe: true }, K初始);
  assert.equal(结果.mode, 'probe');
  assert.equal(结果.scriptVersion, '2026-10-07.1');
  assert.equal(结果.headerOk, true);
  assert.equal(簿.写日志().length, 0);
  assert.equal(结果.changed, 6);
});

test('K清洗·allowWrite：只写有变化的格，公式格/非单号/全空白/干净格都不碰，回读 0 不符', () => {
  const { 结果, 簿 } = 跑(K全文, { allowWrite: true }, K初始, ['K9']);
  assert.equal(结果.wrote, true);
  assert.equal(结果.mode, 'clean');
  assert.equal(结果.written, 5);
  assert.equal(结果.skippedFormula, 1);
  assert.equal(结果.mismatched, 0, 结果.firstMismatch);

  const 格子 = 簿.格子();
  assert.equal(格子.K2, '3620414009188506');
  assert.equal(格子.K3, '3620414009188506');
  assert.equal(格子.K4, '3620414009188506');
  assert.equal(格子.K5, '3620414009188506');
  assert.equal(格子.K12, '3620414009188506', '零宽/BOM 要去掉');
  assert.equal(格子.K6, 'E20260329225342071400041', '干净格不许写');
  assert.equal(格子.K7, '/', '斜杠跳过');
  assert.equal(格子.K8, '   ', '全空白不许清空');
  assert.equal(格子.K9, ' 3620414009188506', '公式格不许覆盖');
  assert.equal(格子.K10, '- ', '洗成 - 的跳过');
  assert.equal(格子.A2, '序号一号', '别的列一个字节不碰');
  assert.equal(格子.L2, '别碰我 ', '别的列一个字节不碰');
  assert.deepEqual(簿.写日志().map((x) => x.地址), ['K2', 'K3', 'K4', 'K5', 'K12']);
  assert.deepEqual(簿.格式日志().map((x) => x.地址), ['K2', 'K3', 'K4', 'K5', 'K12'], '写前设文本格式防丢精度');
});

test('K清洗·安全闸门：K1 表头不对 → 拒绝写入', () => {
  const { 结果, 簿 } = 跑(K全文, { allowWrite: true }, { ...K初始, K1: '别的表头' });
  assert.equal(结果.wrote, false);
  assert.match(结果.message, /表头/);
  assert.equal(簿.写日志().length, 0);
});

// ================= C. 勾选已完结（单元格复选框版） =================
// F 格：1=勾 ☑，0=未勾 ☐（网页实测的存储形态）。
const 表头行 = {
  A1: '登记时间', B1: '店铺名称', C1: 'ID/订单编号', F1: '是否已完结',
  N1: '湖南', O1: '京东仓', P1: '撕单', Q1: '理赔', R1: '异常件表'
};
// 6 个真实数据行（2~8，第 7 行是模板空行）；行2 已勾；行3/4/6/8 未勾有状态；行5 未勾但无真状态
function 造交接() {
  return {
    ...表头行,
    A2: '2026/1/1', C2: '订单1', F2: 1, N2: '已退款',
    A3: '2026/1/2', C3: '订单2', F3: 0, N3: '平台已退款',
    A4: '2026/1/3', C4: '订单3', F4: 0, O4: '已退回京东仓',
    A5: '2026/1/4', C5: '订单4', F5: 0, N5: '#N/A', O5: '0', P5: '/', R5: '#REF!',
    A6: '2026/1/5', C6: '订单5', F6: 0, P6: '理赔中',
    F7: 0,
    A8: '2026/1/6', C8: '订单6', F8: 0, Q8: '12.49'
  };
}

test('勾选·probe：报数据末行，不写', () => {
  const { 结果, 簿 } = 跑(勾选全文, { probe: true }, 造交接());
  assert.equal(结果.mode, 'probe');
  assert.equal(结果.lastRow, 8);
  assert.equal(结果.scriptVersion, '2026-10-07.4');
  assert.equal(簿.写日志().length, 0);
});

test('勾选·试「单格读」：F2 判勾（值1）、F7 判空（值0），一字节不写', () => {
  const { 结果, 簿 } = 跑(勾选全文, { 试: '单格读' }, 造交接());
  assert.equal(结果.mode, '试');
  assert.equal(结果.试, '单格读');
  const F2 = 结果.明细.find((x) => x.行 === 2);
  const F3 = 结果.明细.find((x) => x.行 === 3);
  assert.equal(F2.ok, true);
  assert.equal(F2.值, '1');
  assert.equal(F2.判, '勾');
  assert.equal(F2.文本, '☑');
  assert.equal(F3.值, '0');
  assert.equal(F3.判, '空');
  assert.equal(F3.文本, '☐');
  assert.equal(簿.写日志().length, 0);
});

test('勾选·试「F块读」：分块可读、长度对', () => {
  const { 结果, 簿 } = 跑(勾选全文, { 试: 'F块读' }, 造交接());
  const 首 = 结果.明细.find((x) => x.范围 === 'F2:F51');
  assert.equal(首.ok, true);
  assert.equal(首.长度, 50, 'F2:F51 共 50 行（超数据区也照样返回，末行由调用方按 lastRow 截）');
  assert.equal(簿.写日志().length, 0);
});

test('勾选·试「未勾行」：找出所有 F=0 的行', () => {
  const { 结果 } = 跑(勾选全文, { 试: '未勾行' }, 造交接());
  assert.equal(结果.末行, 8);
  assert.equal(结果.块错, 0);
  assert.deepEqual(结果.未勾样例, [3, 4, 5, 6, 7, 8]);
  assert.equal(结果.未勾数, 6);
});

test('勾选·试「写试」：写 1 → 回读勾 → 还原回 0（净变化为零）', () => {
  const { 结果, 簿 } = 跑(勾选全文, { 试: '写试', 写试行: 3000 }, 造交接());
  assert.equal(结果.试行, 3000);
  const 写前 = 结果.步骤.find((x) => x.步 === '写前');
  const 写后 = 结果.步骤.find((x) => x.步 === '写后');
  const 还原后 = 结果.步骤.find((x) => x.步 === '还原后');
  assert.equal(写前.判, '空');
  assert.equal(写后.判, '勾');
  assert.equal(写后.值, '1');
  assert.equal(还原后.判, '空');
  assert.equal(还原后.值, '0');
  assert.deepEqual(簿.写日志().map((x) => [x.地址, x.值]), [['F3000', 1], ['F3000', 0]], '净变化为零');
});

test('勾选·dryRun（自检）：候选 = 渠道有真状态 且 F 未勾', () => {
  const { 结果, 簿 } = 跑(勾选全文, { dryRun: true }, 造交接());
  assert.equal(结果.mode, 'dryRun');
  assert.equal(结果.headerOk, true);
  assert.equal(簿.写日志().length, 0);
  assert.equal(结果.scanned, 6, '真实数据行 6 行');
  assert.deepEqual(结果.candidates.map((c) => c.行), [3, 4, 6, 8]);
  assert.deepEqual(结果.candidates.map((c) => c.单号), ['订单2', '订单3', '订单5', '订单6']);
  assert.deepEqual(结果.candidates[0].命中, [{ 渠道: '湖南', 值: '平台已退款' }]);
  assert.deepEqual(结果.candidates[1].命中, [{ 渠道: '京东仓', 值: '已退回京东仓' }]);
  assert.deepEqual(结果.candidates[3].命中, [{ 渠道: '理赔', 值: '12.49' }]);
  assert.equal(结果.skipped.未勾数, 6);
  assert.equal(结果.skipped.空行, 1);
  assert.deepEqual(结果.ticked, []);
});

test('勾选·dryRun（指定行）：复核后只留该勾的，已勾/无状态的跳过', () => {
  const { 结果, 簿 } = 跑(勾选全文, { dryRun: true, 候选行: [2, 3, 5, 8] }, 造交接());
  assert.deepEqual(结果.candidates.map((c) => c.行), [3, 8]);
  assert.deepEqual(结果.skipped.指定跳过, [
    { 行: 2, 因: 'F 已经是勾' },
    { 行: 5, 因: '渠道列没有真状态' }
  ]);
  assert.equal(簿.写日志().length, 0);
});

test('勾选·allowWrite：只勾候选行、只勾不取消、回读 0 不符', () => {
  const { 结果, 簿 } = 跑(勾选全文, { allowWrite: true }, 造交接());
  assert.equal(结果.mode, 'tick');
  assert.equal(结果.wrote, true);
  assert.deepEqual(结果.ticked, [3, 4, 6, 8]);
  assert.equal(结果.written, 4);
  assert.equal(结果.mismatched, 0, 结果.firstMismatch);
  assert.equal(结果.failed, 0);
  const 格子 = 簿.格子();
  assert.equal(格子.F2, 1, '已勾的不许重写/不许取消');
  assert.equal(格子.F3, 1);
  assert.equal(格子.F4, 1);
  assert.equal(格子.F6, 1);
  assert.equal(格子.F8, 1);
  assert.equal(格子.F5, 0, '无真状态的不许勾');
  assert.equal(格子.F7, 0, '模板空行不许勾');
  assert.deepEqual(簿.写日志().map((x) => x.地址), ['F3', 'F4', 'F6', 'F8'], '只有候选行被写');
  assert.ok(结果.readBack.every((x) => x.说明.indexOf('已勾上') + 1));
});

test('勾选·allowWrite（指定行）：只写指定行', () => {
  const { 结果, 簿 } = 跑(勾选全文, { allowWrite: true, 候选行: [3] }, 造交接());
  assert.deepEqual(结果.ticked, [3]);
  assert.equal(簿.写日志().length, 1);
  assert.deepEqual(簿.写日志().map((x) => x.地址), ['F3']);
});

test('勾选·毒错误回归：读块抛「message 一碰就炸」的错误 → 脚本不许死，要报读异常', () => {
  const { 结果, 簿 } = 跑(勾选全文, { dryRun: true }, 造交接(), [], ['A2:E8']);
  assert.equal(结果.mode, 'dryRun');
  assert.deepEqual(结果.candidates, [], '渠道扫描块读不到 → 没有候选（不许当没状态）');
  assert.deepEqual(结果.读异常, ['2-8']);
  assert.equal(簿.写日志().length, 0);
});

test('勾选·安全闸门：F1 表头不对 → 拒绝动手', () => {
  const { 结果, 簿 } = 跑(勾选全文, { allowWrite: true }, { ...造交接(), F1: '别的表头' });
  assert.equal(结果.mode, 'error');
  assert.equal(结果.headerOk, false);
  assert.equal(簿.写日志().length, 0);
});
