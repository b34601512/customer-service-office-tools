const test = require('node:test');
const assert = require('node:assert/strict');
const {
  默认目标页面地址,
  默认接口每页条数,
  规范化店铺配置,
  规范化客服姓名,
} = require('../src/store/storeConfigService');

test('默认目标地址是消费者发票全部列表入口', () => {
  assert.equal(默认目标页面地址, 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder');
});

test('空目标地址会回退到常规开票催促页面', () => {
  const store = 规范化店铺配置({ name: '京东1店', targetUrl: '' });
  assert.equal(store.targetUrl, 默认目标页面地址);
});

test('旧店铺配置会补齐申请时间和默认每页条数', () => {
  const store = 规范化店铺配置({ name: '京东1店', targetUrl: '' });
  assert.equal(store.applicationDateRangeDays, 30);
  assert.equal(默认接口每页条数, 10);
  assert.equal(store.pageSize, 10);
});

test('店铺配置支持按配置设置接口每页条数', () => {
  const store = 规范化店铺配置({ name: '京东1店', pageSize: 20 });
  assert.equal(store.pageSize, 20);
});

test('店铺配置支持按申请日期查看最近90天', () => {
  const store = 规范化店铺配置({ name: '京东1店', applicationDateRangeDays: 90 });
  assert.equal(store.applicationDateRangeDays, 90);
});

test('客服姓名会去掉首尾空白并拒绝空值', () => {
  assert.equal(规范化客服姓名(' 张三 '), '张三');
  assert.throws(
    () => 规范化客服姓名(''),
    /客服姓名不能为空/,
  );
});
