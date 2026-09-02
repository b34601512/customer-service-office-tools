const test = require('node:test');
const assert = require('node:assert/strict');

const {
  等待接口优先记录,
  构建接口优先页面结果,
} = require('../src/app/checkInvoices');

test('接口优先记录已存在时可以直接产出候选记录', async () => {
  const records = await 等待接口优先记录({
    获取记录: () => [{
      url: 'https://sz.jd.com/szweb/serviceAnalysis/createInvoiceGovernance/list',
      data: {
        rows: [{
          销售订单编号: '3479429018358831',
          发票上传时间: '-',
          '发票上传倒计时（天）': '还有3天逾期',
        }],
      },
    }],
  }, {
    timeoutMs: 0,
  });

  assert.equal(records.length, 1);
  assert.match(records[0].summary, /3479429018358831/);
});

test('接口优先页面结果会按记录状态生成巡检指标', () => {
  const 页面结果 = 构建接口优先页面结果({
    页面标题: '政企发票考核',
    页面地址: 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html',
  }, [{
    source: '接口数据',
    summary: '销售订单编号:3479429018358831 | 发票上传倒计时（天）:还有3天逾期',
    fields: {
      销售订单编号: '3479429018358831',
      '发票上传倒计时（天）': '还有3天逾期',
    },
  }]);

  assert.equal(页面结果.记录列表.length, 1);
  assert.equal(页面结果.metrics.明细总数, 1);
  assert.equal(页面结果.metrics.待登记明细数, 1);
  assert.equal(页面结果.metrics.警告订单数, 1);
});
