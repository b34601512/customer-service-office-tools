const test = require('node:test');
const assert = require('node:assert/strict');
const { 从页面提取记录 } = require('../src/invoice/extractFromPage');

test('顶部告警大于 0 时即使明细只抓到未逾期也会生成告警记录', async () => {
  const 页面结果 = await 从页面提取记录({
    evaluate: async () => ({
      title: '政企发票考核',
      url: 'https://example.test/invoice',
      bodyText: '警告：您有 1 笔订单剩余处理时间不足5天（即将逾期） | 总共 1 条。',
      records: [{
        source: '页面表格',
        销售订单编号: '3479429018358831',
        发票上传时间: '2026-05-06 14:13:59',
        '发票上传倒计时（天）': '未逾期',
      }],
    }),
  });

  assert.equal(页面结果.metrics.页面警告订单数, 1);
  assert.equal(页面结果.metrics.警告订单数, 1);
  assert.equal(页面结果.metrics.待登记明细数, 1);
  assert.equal(页面结果.metrics.已上传未逾期数, 1);
  assert.equal(页面结果.记录列表.length, 2);
  assert.ok(页面结果.记录列表.some((记录) => /顶部提示/.test(记录.summary)));
});

test('顶部告警为 0 时下方 3 条已上传未逾期明细不计入待登记', async () => {
  const 页面结果 = await 从页面提取记录({
    evaluate: async () => ({
      title: '政企发票考核',
      url: 'https://example.test/invoice',
      bodyText: '警告：您有0笔订单剩余处理时间不足5天（即将逾期），为避免影响考核达标，请立即完成上传操作。 | 核心指标 | 及时上传发票订单数 | 3 | 应上传发票订单数 | 3 | 总共3条。',
      records: [
        {
          source: '页面表格',
          销售订单编号: '3478223018065109',
          发票上传时间: '2026-05-06 14:20:25',
          '发票上传倒计时（天）': '未逾期',
        },
        {
          source: '页面表格',
          销售订单编号: '3477209008120436',
          发票上传时间: '2026-05-06 14:21:07',
          '发票上传倒计时（天）': '未逾期',
        },
        {
          source: '页面表格',
          销售订单编号: '3476275003020679',
          发票上传时间: '2026-05-08 20:03:51',
          '发票上传倒计时（天）': '未逾期',
        },
      ],
    }),
  });

  assert.equal(页面结果.metrics.顶部警告已识别, true);
  assert.equal(页面结果.metrics.页面警告订单数, 0);
  assert.equal(页面结果.metrics.警告订单数, 0);
  assert.equal(页面结果.metrics.待登记明细数, 0);
  assert.equal(页面结果.metrics.已上传未逾期数, 3);
});

test('核心指标差额大于 0 时不依赖顶部 5 天预警也会报警', async () => {
  const 页面结果 = await 从页面提取记录({
    evaluate: async () => ({
      title: '政企发票考核',
      url: 'https://example.test/invoice',
      bodyText: '警告：您有0笔订单剩余处理时间不足5天（即将逾期） | 核心指标 | 及时上传发票订单数 | 0 | 应上传发票订单数 | 1 | 总共1条。',
      records: [{
        source: '页面表格',
        销售订单编号: '3489470007408765',
        发票上传时间: '-',
        '发票上传倒计时（天）': '还有8天逾期',
      }],
    }),
  });

  assert.equal(页面结果.metrics.页面警告订单数, 0);
  assert.equal(页面结果.metrics.及时上传发票订单数, 0);
  assert.equal(页面结果.metrics.应上传发票订单数, 1);
  assert.equal(页面结果.metrics.待上传发票订单数, 1);
  assert.equal(页面结果.metrics.警告订单数, 1);
  assert.equal(页面结果.metrics.待登记明细数, 1);
  assert.equal(页面结果.记录列表.length, 1);
  assert.match(页面结果.记录列表[0].summary, /还有8天逾期/);
});
