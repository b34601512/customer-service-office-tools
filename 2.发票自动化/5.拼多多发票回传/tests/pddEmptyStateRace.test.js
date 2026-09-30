// 反向断言（2026-09-30）：拼多多后台先渲染「暂无数据」空态、再把列表数据填进来。
// 如果只读一眼空态就返回「0 单」，就会把有单的店铺读成无单（09-28 拼多多02店、09-29/09-30 拼多多03店各 1 次）。
// 本测试锁死：空态必须连续确认；数据到达后必须读到订单。
const assert = require('node:assert');
const {
  是拼多多待开票空态文本,
  等待拼多多待开票列表或登录页,
} = require('../src/invoiceReturn/pddInvoicePage');

const 空态正文 = '订单开票 批量导出 暂无数据';
const 有单正文 = '订单开票 批量导出 录入发票 202509300001-1234567890123';

/** 造一个按「正文序列」推进的假页面：越界后沿用最后一条正文。 */
function 造假页面(正文序列) {
  let 读取次数 = 0;
  const 当前正文 = () => 正文序列[Math.min(读取次数, 正文序列.length - 1)];
  return {
    读到几次: () => 读取次数,
    url: () => 'https://mms.pinduoduo.com/invoice/order',
    async evaluate() {
      读取次数 += 1;
      return [];
    },
    locator(选择器) {
      if (选择器 === 'body') {
        return { innerText: async () => 当前正文() };
      }
      return {
        last: () => ({ count: async () => 0 }),
        count: async () => 0,
        filter: () => ({ first: () => ({ count: async () => 0, isVisible: async () => false }) }),
      };
    },
    keyboard: { press: async () => {} },
    async bringToFront() {},
  };
}

(async () => {
  // 空态判定本身：只有「没有录入发票入口」才算空态。
  assert.strictEqual(是拼多多待开票空态文本(空态正文), true, '完整空态必须被判为空态');
  assert.strictEqual(是拼多多待开票空态文本(有单正文), false, '有订单行时不得判为空态');
  assert.strictEqual(是拼多多待开票空态文本('订单开票 批量导出 录入发票'), false, '有录入发票入口时不得判为空态');

  // 场景一（回归主案）：先空态、后出数据 → 必须等到有数据的正文，不能一眼空态就收工。
  const 竞态页 = 造假页面([空态正文, 空态正文, 有单正文, 有单正文]);
  const 竞态结果 = await 等待拼多多待开票列表或登录页(竞态页, 20_000);
  assert.strictEqual(竞态结果.state, 'ready');
  assert.ok(
    竞态结果.text.includes('录入发票'),
    `空态后到达的数据必须被读到（实际读到：${竞态结果.text}）`
  );

  // 场景二（反向断言）：持续空态 → 连续确认后仍必须返回 ready（真 0 单不能被卡成超时）。
  const 真空态页 = 造假页面([空态正文]);
  const 真空态结果 = await 等待拼多多待开票列表或登录页(真空态页, 20_000);
  assert.strictEqual(真空态结果.state, 'ready');
  assert.ok(
    真空态页.读到几次() >= 2,
    '空态必须至少连续确认两次，防止把“数据未到”当成“0 单”'
  );

  // 场景三（反向断言）：非空态就绪时不得引入额外等待，必须第一次就读到。
  const 有单页 = 造假页面([有单正文]);
  const 有单结果 = await 等待拼多多待开票列表或登录页(有单页, 20_000);
  assert.ok(有单结果.text.includes('录入发票'));

  console.log('pddEmptyStateRace.test.js: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
