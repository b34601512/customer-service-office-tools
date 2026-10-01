// 知识卡任务执行器：纯函数单测（不访问后台、不写任何数据）
// 运行：node --test "17.探域科技AI自动配置/01.通用/工具/测试/知识卡任务执行器.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const ex = require('../探域知识卡任务执行器.cjs');

const DD = 'shop-德达', DK = 'shop-DEDAKJ';
const card = () => ({
  id: '123',
  title: '运费承担原则',
  content: [{ content: '第一段' }, { content: '第二段' }],
  labels: ['运费'],
  ifBelievable: true,
  type: 'SHOP',
  ifOpen: true,
  includeCondition: { spu: [], shop: [{ thirdShopId: DD, cids: [] }], rules: [], productGroupId: [], sellerGroup: [], platform: [] },
  excludeCondition: null,
  timeliness: null,
  cycleTimeliness: null,
  orderStatus: [],
  lastUpdatedAt: 111
});

test('① 默认防误改：不传 businessPatch 时，业务字段原样进 payload，期望值=原值', () => {
  const before = card();
  const payload = ex.payloadFrom(before, ['新正文']);
  assert.deepEqual(payload.includeCondition, before.includeCondition);
  assert.equal(payload.id, '123');
  assert.equal(payload.title, '运费承担原则');
  assert.deepEqual(payload.content, [{ content: '新正文' }]);
  assert.equal(ex.stable(ex.expectedBusinessAfter(before, null)), ex.stable(ex.businessMeta(before)));
});

test('② 正文替换不动业务字段，SHA 只随正文变', () => {
  const before = card();
  const payload = ex.payloadFrom(before, ['第一段', '第二段']);
  assert.equal(ex.sha(ex.segments(payload.content)), ex.sha(ex.segments(before.content)));
});

test('③ businessPatch 覆盖绑店：shop 整体替换、其余条件键保留', () => {
  const before = card();
  const patched = ex.mergeBusinessPatch(ex.payloadFrom(before, before.content), {
    includeCondition: { shop: [{ thirdShopId: DD, cids: [] }, { thirdShopId: DK, cids: ['c1'] }] }
  });
  assert.deepEqual(patched.includeCondition.shop, [{ thirdShopId: DD, cids: [] }, { thirdShopId: DK, cids: ['c1'] }]);
  assert.deepEqual(patched.includeCondition.spu, []);
  assert.deepEqual(patched.includeCondition.platform, []);
  // 期望值：保留正文以外的业务字段，并应用补丁
  const expect = ex.expectedBusinessAfter(before, { includeCondition: { shop: [{ thirdShopId: DK }] } });
  assert.deepEqual(expect.includeCondition.shop, [{ thirdShopId: DK }]);
  assert.equal(expect.title, '运费承担原则');
  assert.equal(expect.ifOpen, true);
});

test('④ 期望值比较能抓出错配：绑店不对 → metaOk=false', () => {
  const before = card();
  const expect = ex.expectedBusinessAfter(before, { includeCondition: { shop: [{ thirdShopId: DD }, { thirdShopId: DK }] } });
  const afterBad = { ...card(), includeCondition: { ...card().includeCondition, shop: [{ thirdShopId: DD }] } };
  assert.notEqual(ex.stable(ex.businessMeta(afterBad)), ex.stable(expect));
  const afterGood = { ...card(), includeCondition: { ...card().includeCondition, shop: [{ thirdShopId: DD }, { thirdShopId: DK }] } };
  assert.equal(ex.stable(ex.businessMeta(afterGood)), ex.stable(expect));
});

test('⑤ 补丁形状锁：不许碰 id / content / lastUpdatedAt / 未知字段', () => {
  assert.throws(() => ex.assertPatchShape({ id: 'x' }), /不允许包含字段 id/);
  assert.throws(() => ex.assertPatchShape({ content: [] }), /不允许包含字段 content/);
  assert.throws(() => ex.assertPatchShape({ lastUpdatedAt: 1 }), /不允许包含字段 lastUpdatedAt/);
  assert.throws(() => ex.assertPatchShape({ foo: 1 }), /不允许包含字段 foo/);
  assert.doesNotThrow(() => ex.assertPatchShape({ includeCondition: { shop: [] }, ifOpen: false }));
});

test('⑥ 红线锁：改业务字段必须「有确认人 + 显式放行」，缺一即拒', () => {
  const patch = { includeCondition: { shop: [{ thirdShopId: DK }] } };
  assert.throws(() => ex.assertBusinessChangeAllowed({ patch, approvedBy: '', allowFlag: 'true' }), /approvedBy/);
  assert.throws(() => ex.assertBusinessChangeAllowed({ patch, approvedBy: '某主管', allowFlag: 'false' }), /allow-business-change/);
  assert.throws(() => ex.assertBusinessChangeAllowed({ patch, approvedBy: '   ', allowFlag: 'true' }), /approvedBy/);
  assert.equal(ex.assertBusinessChangeAllowed({ patch, approvedBy: '某主管', allowFlag: 'true' }), true);
  assert.equal(ex.assertBusinessChangeAllowed({ patch: null, approvedBy: '', allowFlag: 'false' }), false);
  assert.equal(ex.assertBusinessChangeAllowed({ patch: {}, approvedBy: '', allowFlag: 'false' }), false);
});

test('⑦ 写前断言（expected）能拦住“卡已被别人改过”', () => {
  const before = card();
  // 计划里写：这张卡当前应该只绑德达
  assert.deepEqual(ex.checkExpected(before, { includeCondition: { spu: [], shop: [{ thirdShopId: DD, cids: [] }], rules: [], productGroupId: [], sellerGroup: [], platform: [] } }), []);
  const moved = { ...card(), includeCondition: { ...card().includeCondition, shop: [{ thirdShopId: DK }] } };
  assert.deepEqual(ex.checkExpected(moved, { includeCondition: { spu: [], shop: [{ thirdShopId: DD }], rules: [], productGroupId: [], sellerGroup: [], platform: [] } }), ['includeCondition']);
});

test('⑧ 空排除条件按 [] 归一化比较', () => {
  const a = { ...card(), excludeCondition: null };
  const b = { ...card(), excludeCondition: { spu: [], shop: [], rules: [], productGroupId: [], sellerGroup: [], platform: [] } };
  assert.equal(ex.stable(ex.businessMeta(a)), ex.stable(ex.businessMeta(b)));
});

test('⑨ 只改绑店（正文不动）时不能被当成 already-target 跳过', () => {
  const before = card();
  const patch = { includeCondition: { shop: [{ thirdShopId: DD }, { thirdShopId: DK }] } };
  const expect = ex.expectedBusinessAfter(before, patch);
  const cur = ex.businessMeta(before);
  // 正文相同 + 业务字段未改 → 不算到位（要继续写）
  assert.equal(ex.atTarget({ currentContent: ['第一段', '第二段'], after: ['第一段', '第二段'], currentBusiness: cur, expectBusiness: expect }), false);
  // 正文相同 + 业务字段已是补丁后的值 → 到位
  const afterCard = { ...before, includeCondition: { ...before.includeCondition, shop: [{ thirdShopId: DD }, { thirdShopId: DK }] } };
  assert.equal(ex.atTarget({ currentContent: ['第一段', '第二段'], after: ['第一段', '第二段'], currentBusiness: ex.businessMeta(afterCard), expectBusiness: expect }), true);
  // 不传补丁时行为不变：正文相同即到位
  assert.equal(ex.atTarget({ currentContent: ['第一段', '第二段'], after: ['第一段', '第二段'], currentBusiness: cur, expectBusiness: ex.businessMeta(before) }), true);
  // 正文不同 → 一律不到位
  assert.equal(ex.atTarget({ currentContent: ['旧'], after: ['新'], currentBusiness: ex.businessMeta(afterCard), expectBusiness: expect }), false);
});

// ⑩ 新建回读校验：期望值跟着任务书走（不再硬编码「新建=停用、不绑店」）
//    2026-10-01 现场：德达链接卡任务书写了 ifOpen:true + 绑德达店，旧硬编码会把正确结果误判成 created-verify-failed
test('⑩ 新建回读：任务书要启用+绑店 → 回读一致才算过（不许硬编码停用/空绑店）', () => {
  const 任务书 = { ifOpen: true, includeCondition: { shop: ['2095398963959042048'] } };
  const 回读对 = { content: [{ content: 'Q:x\nA:y' }], ifOpen: true, includeCondition: { shop: ['2095398963959042048'] } };
  const 回读错 = { content: [{ content: 'Q:x\nA:y' }], ifOpen: false, includeCondition: { shop: [] } };
  const 对 = ex.verifyCreated({ created: 回读对, business: 任务书, after: 'Q:x\nA:y' });
  assert.deepEqual(对, { contentOk: true, openOk: true, scopeOk: true });
  const 错 = ex.verifyCreated({ created: 回读错, business: 任务书, after: 'Q:x\nA:y' });
  assert.equal(错.openOk, false);
  assert.equal(错.scopeOk, false);
});

test('⑩b 新建回读：任务书没写 ifOpen（默认停用）→ 回读启用就算不一致', () => {
  const 对 = ex.verifyCreated({ created: { content: [{ content: 'A' }], ifOpen: false, includeCondition: { shop: [] } }, business: {}, after: 'A' });
  assert.deepEqual(对, { contentOk: true, openOk: true, scopeOk: true });
  const 错 = ex.verifyCreated({ created: { content: [{ content: 'A' }], ifOpen: true, includeCondition: { shop: [] } }, business: {}, after: 'A' });
  assert.equal(错.openOk, false);
});
