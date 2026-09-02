const test = require('node:test');
const assert = require('node:assert/strict');
const {
  构建最近日期范围,
  构建快速查询请求体,
  构建列表查询请求体,
  解析发票查询列表,
  解析主体列表,
  排列主体查询顺序,
  选择可下载发票记录,
} = require('../src/nuonuo/invoiceApiDownloader');

test('诺诺快速查询请求体支持订单编号查询', () => {
  const body = 构建快速查询请求体('3526239002731910', 0);
  assert.match(body, /name_order=3526239002731910/);
  assert.match(body, /orderNoType=0/);
  assert.match(body, /search_type=1/);
});

test('最近日期范围默认按天数回推', () => {
  const range = 构建最近日期范围(30, new Date('2026-07-02T12:00:00+08:00'));
  assert.deepEqual(range, {
    dateStart: '2026-06-03',
    dateEnd: '2026-07-02',
  });
});

test('诺诺列表兜底查询请求体包含日期范围和分页', () => {
  const body = 构建列表查询请求体({ dateStart: '2026-06-03', dateEnd: '2026-07-02', current: 1, pCount: 100 });
  assert.match(body, /dateStart=2026-06-03/);
  assert.match(body, /dateEnd=2026-07-02/);
  assert.match(body, /pCount=100/);
});

test('诺诺查询列表解析失败会抛出接口错误', () => {
  assert.throws(
    () => 解析发票查询列表({ status: 500, message: '失败' }),
    /失败/,
  );
});

test('只选择已完成且有下载地址的发票记录', () => {
  const record = 选择可下载发票记录([
    { c_status: '开票中', pdf_url: 'https://example.com/a.pdf' },
    { c_status: '开票完成', pdf_url: 'https://example.com/b.pdf' },
  ]);
  assert.equal(record.pdf_url, 'https://example.com/b.pdf');
});

test('诺诺主体列表会解析默认主体和可切换主体', () => {
  const result = 解析主体列表({
    code: 200,
    data: {
      defaultCompanyId: 'b',
      switchCompanyList: [
        { id: 'a', name: 'A公司', taxNum: 'tax-a' },
        { id: 'b', name: 'B公司', taxNum: 'tax-b' },
      ],
    },
  });
  assert.equal(result.defaultCompanyId, 'b');
  assert.equal(result.companies.length, 2);
});

test('多主体查询顺序优先默认主体', () => {
  const ordered = 排列主体查询顺序([
    { id: 'a', name: 'A公司' },
    { id: 'b', name: 'B公司' },
  ], 'b');
  assert.deepEqual(ordered.map((company) => company.id), ['b', 'a']);
});
