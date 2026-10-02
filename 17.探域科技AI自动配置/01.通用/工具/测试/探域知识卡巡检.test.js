// 探域知识卡巡检：纯函数单测（不连后台、不写任何数据）
// 运行：node --test "17.探域科技AI自动配置/01.通用/工具/测试/探域知识卡巡检.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const 巡检 = require('../探域知识卡巡检.cjs');

const DEDAKJ = '2104457457798483968';
const 德达 = '2095398963959042048';

const 卡 = (补 = {}) => ({
  id: 补.id || 'c1',
  title: 补.title !== undefined ? 补.title : '标题',
  content: 补.content || [{ content: '正文甲' }],
  ifOpen: 补.ifOpen !== undefined ? 补.ifOpen : true,
  type: 补.type || 'SHOP',
  labels: 补.labels || ['通用'],
  includeCondition: 补.includeCondition || { spu: [], shop: [{ thirdShopId: 补.shop || DEDAKJ, cids: [] }] },
  excludeCondition: { spu: [], shop: [], rules: [], productGroupId: [], sellerGroup: [], platform: [] },
  productCondition: null,
  lastUpdatedAt: 补.lastUpdatedAt || '2026-01-01 00:00:00',
});

test('① 归一化正文：去首尾空白与空行、行内空白折叠', () => {
  const c = 卡({ content: [{ content: '  第一行   ' }, { content: '' }, { content: ' 第二  行 ' }] });
  assert.equal(巡检.归一化正文(c), '第一行\n第二 行');
  assert.equal(巡检.正文全文(c), '  第一行   \n\n 第二  行 ');
});

test('② 同文分组：正文相同成组，不同不成组', () => {
  const a = 卡({ id: 'a', content: [{ content: '同样的正文 A' }] });
  const b = 卡({ id: 'b', content: [{ content: ' 同样的正文   A ' }] });
  const c = 卡({ id: 'c', content: [{ content: '不一样' }] });
  const 组 = 巡检.正文分组([a, b, c]);
  assert.equal(组.length, 1);
  assert.equal(组[0].张数, 2);
  assert.deepEqual(组[0].卡.map((x) => x.id).sort(), ['a', 'b']);
});

test('③ 近似分组：≥95% 相似成组；完全同文不进近似组；差异大不成组', () => {
  const 长文 = Array.from({ length: 24 }, (_, i) => `第${i + 1}条制氧机使用提醒：请放置在通风处，远离明火与易燃物，进水口保持清洁，过滤棉建议每两周清洗一次。`).join('\n');
  const a = 卡({ id: 'a', content: [{ content: 长文 }] });
  const b = 卡({ id: 'b', content: [{ content: 长文.replace('每两周', '每三周') }] });
  const 同文 = 卡({ id: 'same', content: [{ content: 长文 }] });
  const 差异 = 卡({ id: 'diff', content: [{ content: '完全不同的内容：关于发票与运费说明。'.repeat(3) }] });
  const 组 = 巡检.近似分组([a, b, 同文, 差异]);
  assert.equal(组.length, 1);
  assert.ok(组[0].最小相似度 >= 0.95 && 组[0].最小相似度 < 1);
  assert.deepEqual(组[0].卡.map((x) => x.id).sort(), ['a', 'b']);
});

test('④ 引流词：命中出候选；反向劝阻句带提示；无词不候选', () => {
  const 正常 = 卡({ id: 'n1', content: [{ content: '加微信号 abc123 领取教程' }] });
  const 反向 = 卡({ id: 'n2', content: [{ content: '无需添加微信、关注公众号或扫码跳转站外。' }] });
  const 干净 = 卡({ id: 'n3', content: [{ content: '店内联系客服即可。' }] });
  const items = 巡检.扫引流词([正常, 反向, 干净]);
  assert.deepEqual(items.map((x) => x.id).sort(), ['n1', 'n2']);
  assert.equal(items.find((x) => x.id === 'n1').疑似反向劝阻, false);
  assert.equal(items.find((x) => x.id === 'n2').疑似反向劝阻, true);
});

test('⑤ 停用卡：只收 ifOpen=false；有开启同文时给「被取代」提示', () => {
  const 开 = 卡({ id: 'o1', ifOpen: true, content: [{ content: '同文' }] });
  const 停1 = 卡({ id: 's1', ifOpen: false, content: [{ content: '同文' }] });
  const 停2 = 卡({ id: 's2', ifOpen: false, content: [{ content: '独有正文' }] });
  const items = 巡检.扫停用卡([开, 停1, 停2]);
  assert.deepEqual(items.map((x) => x.id).sort(), ['s1', 's2']);
  assert.match(items.find((x) => x.id === 's1').提示, /取代/);
  assert.match(items.find((x) => x.id === 's2').提示, /待人工判定/);
});

test('⑥ 绑店错位：标题品牌≠绑店命中；同店不命中；未绑店命中', () => {
  const 跨 = 卡({ id: 'd1', title: 'DEDAKJ 制氧机水箱容量对比', shop: 德达 });
  const 同 = 卡({ id: 'd2', title: 'DEDAKJ 制氧机水箱容量对比', shop: DEDAKJ });
  const 未绑 = 卡({ id: 'd3', title: '晒单赠品', includeCondition: { spu: [], shop: [] } });
  const items = 巡检.扫绑店错位([跨, 同, 未绑]);
  assert.deepEqual(items.map((x) => x.id).sort(), ['d1', 'd3']);
  assert.deepEqual(items.find((x) => x.id === 'd1').标题跨品牌, ['DEDAKJ']);
  assert.equal(items.find((x) => x.id === 'd3').未绑店, true);
});

test('⑦ 过期时间词：活动/日期命中；过去日期有提示、未来日期没有', () => {
  const 过去 = 卡({ id: 't1', content: [{ content: '活动截至2024年10月7日，赠品送完即止。' }] });
  const 未来 = 卡({ id: 't2', content: [{ content: '活动时间 2027年10月7日 开始。' }] });
  const 干净 = 卡({ id: 't3', content: [{ content: '整机质保一年。' }] });
  const items = 巡检.扫过期时间词([过去, 未来, 干净], new Date(2026, 9, 2));
  assert.deepEqual(items.map((x) => x.id).sort(), ['t1', 't2']);
  assert.equal(items.find((x) => x.id === 't1').疑似含过去日期, true);
  assert.equal(items.find((x) => x.id === 't2').疑似含过去日期, false);
  assert.ok(items.find((x) => x.id === 't1').命中.some((h) => h.组 === '活动'));
});

test('⑧ fail-closed：results < total 必须报错停下；数组输入原样通过', () => {
  assert.throws(() => 巡检.校验全量({ total: 3, results: [{ id: 1 }, { id: 2 }] }), /拉取不全/);
  assert.throws(() => 巡检.校验全量({ total: 0, results: [] }), /total=0/);
  assert.deepEqual(巡检.校验全量([{ id: 1 }]), [{ id: 1 }]);
});

test('⑨ 运行巡检：同输入同输出（确定性），六类都有计数', () => {
  const cards = [
    卡({ id: 'a', content: [{ content: '加微信号 x' }] }),
    卡({ id: 'b', content: [{ content: '加微信号 x' }] }),
    卡({ id: 'c', ifOpen: false, content: [{ content: '停用正文' }] }),
    卡({ id: 'd', title: 'DEDAKJ 对比', shop: 德达 }),
    卡({ id: 'e', content: [{ content: '活动截至2025年1月1日' }] }),
    卡({ id: 'f', content: [{ content: '热线400-830-2119' }] }),
  ];
  const r1 = 巡检.运行巡检({ cards, 数据来源: '测试', 判定基准日: new Date(2026, 9, 2) });
  const r2 = 巡检.运行巡检({ cards, 数据来源: '测试', 判定基准日: new Date(2026, 9, 2) });
  assert.deepEqual(r1, r2);
  assert.equal(r1.类别.引流词.候选数, 2);
  assert.equal(r1.类别.重复卡.同文组数, 1);
  assert.equal(r1.类别.停用卡.候选数, 1);
  assert.equal(r1.类别.绑店错位.候选数, 1);
  assert.equal(r1.类别.过期时间词.候选数, 1);
  assert.equal(r1.类别.电话号一致性.号码数, 1);
  assert.equal(r1.类别.电话号一致性.异常数, 0);
});

test('⑩ 渲染 md：六类候选文件都生成且含标题', () => {
  const r = 巡检.运行巡检({ cards: [卡({ id: 'a' })], 数据来源: '测试', 判定基准日: new Date(2026, 9, 2) });
  const md = 巡检.渲染md(r);
  assert.deepEqual(Object.keys(md).sort(), ['停用卡-候选.md', '引流词-候选.md', '电话号一致性-候选.md', '绑店错位-候选.md', '过期时间词-候选.md', '重复卡-候选.md'].sort());
  for (const [名, 文] of Object.entries(md)) assert.ok(文.startsWith('# '), 名 + ' 缺标题');
});

test('⑪ 反向断言：脚本不出现任何写接口词，且只调用一个只读接口', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '探域知识卡巡检.cjs'), 'utf8');
  assert.ok(!/apply/i.test(src), '脚本不得出现 apply');
  assert.ok(!/delete/i.test(src), '脚本不得出现 delete');
  assert.ok(!/batch-delete/i.test(src), '脚本不得出现 batch-delete');
  assert.ok(!/save/i.test(src), '脚本不得出现 save');
  assert.ok(!/config-save/i.test(src), '脚本不得出现 config-save');
  assert.ok(!/config\/save/i.test(src), '脚本不得出现 config/save');
  assert.ok(!/save-learn/i.test(src), '脚本不得出现 save-learn');
  const 接口 = [...src.matchAll(/\/api\/[a-zA-Z0-9_\-\/]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(接口)], ['/api/kbe/v1/knowledge-card/page']);
});

test('⑫ 电话号一致性：空格/全角/不同分段归一化后成同一号', () => {
  const 四 = [
    卡({ id: 'p1', content: [{ content: '热线 400-830-2 19' }] }),
    卡({ id: 'p2', content: [{ content: '热线 400-830-219' }] }),
    卡({ id: 'p3', content: [{ content: '热线 400 830 2119' }] }),
    卡({ id: 'p4', content: [{ content: '热线 ４００-８３０-２１１９' }] }),
  ];
  const x = 巡检.扫电话号一致性(四);
  assert.equal(x.号码数, 2);
  const 主 = x.items.find((it) => it.号码 === '4008302119');
  const 短 = x.items.find((it) => it.号码 === '400830219');
  assert.ok(主 && 短);
  assert.equal(主.类别, '400热线');
  assert.equal(主.位数, 10);
  assert.deepEqual([...主.卡id].sort(), ['p3', 'p4']);
  assert.deepEqual([...短.卡id].sort(), ['p1', 'p2']);
});

test('⑬ 电话号：纯数字与带横线判为同一号；位数 <8 的不算号', () => {
  const a = 卡({ id: 'a', content: [{ content: '电话4008302119' }] });
  const b = 卡({ id: 'b', content: [{ content: '电话400-830-2119' }] });
  const c = 卡({ id: 'c', content: [{ content: '热线400-830-2' }] });
  const x = 巡检.扫电话号一致性([a, b, c]);
  assert.equal(x.号码数, 1);
  assert.deepEqual([...x.items[0].卡id].sort(), ['a', 'b']);
});

test('⑭ 电话号异常：400 非主号进异常；主号不进；手机 11 位正常', () => {
  const 主 = 卡({ id: 'm1', content: [{ content: '热线400-830-2119' }] });
  const 错 = 卡({ id: 'm2', content: [{ content: '热线400-830-119' }] });
  const 漏 = 卡({ id: 'm3', content: [{ content: '热线400-830-2 19' }] });
  const 同长 = 卡({ id: 'm4', content: [{ content: '热线400-830-2199' }] });
  const 机 = 卡({ id: 'm5', content: [{ content: '售后177****4984' }] });
  const 短机 = 卡({ id: 'm6', content: [{ content: '售后1771585498' }] });
  const x = 巡检.扫电话号一致性([主, 错, 漏, 同长, 机, 短机]);
  assert.deepEqual(x.异常.map((e) => e.号码).sort(), ['1771585498', '400830119', '400830219', '4008302199'].sort());
  const 同长原因 = x.异常.find((e) => e.号码 === '4008302199').原因.join();
  assert.match(同长原因, /与主号不同/);
  assert.ok(!同长原因.includes('位数不同'), '同长度不能用「位数不同」当理由');
  assert.match(x.异常.find((e) => e.号码 === '400830219').原因.join(), /与主号 4008302119 同前缀但位数不同/);
  assert.match(x.异常.find((e) => e.号码 === '1771585498').原因.join(), /手机号应为 11 位/);
  assert.equal(x.items.find((it) => it.号码 === '177****4984').类别, '手机号');
  assert.equal(x.异常.find((e) => e.号码 === '400830219').分隔怪, true);
});

test('⑮ 电话号分隔异常：空格/点/全角标出；纯横线/纯数字不标', () => {
  const 空格 = 卡({ id: 's1', content: [{ content: '热线400 830 2119' }] });
  const 点 = 卡({ id: 's2', content: [{ content: '热线400.830.2119' }] });
  const 全角 = 卡({ id: 's3', content: [{ content: '热线４００－８３０－２１１９' }] });
  const 横线 = 卡({ id: 's4', content: [{ content: '热线400-830-2119' }] });
  const 纯 = 卡({ id: 's5', content: [{ content: '热线4008302119' }] });
  const x = 巡检.扫电话号一致性([空格, 点, 全角, 横线, 纯]);
  assert.equal(x.号码数, 1); // 五种写法归一化后是同一个号
  assert.deepEqual([...new Set(x.分隔异常.map((e) => e.卡id))].sort(), ['s1', 's2', 's3']);
});

test('⑯ 电话号：编号类数字仍统计，但提示「疑似非电话」', () => {
  const c = 卡({ id: 'n1', content: [{ content: '验厂报告编号192****4615' }] });
  const x = 巡检.扫电话号一致性([c]);
  const it = x.items.find((i) => i.号码 === '192****4615');
  assert.equal(it.类别, '手机号');
  assert.equal(it.疑似非电话, true);
});

test('⑰ 电话号：400-830-2119 与主号一致时不进异常', () => {
  const c = 卡({ id: 'x', content: [{ content: '全国服务热线：400-830-2119' }] });
  const x = 巡检.扫电话号一致性([c]);
  assert.equal(x.号码数, 1);
  assert.equal(x.异常数, 0);
  assert.equal(x.分隔异常数, 0);
});

test('⑱ 引流词 D10：归一化后识别空格/全角/大小写变体，新词表命中引导句', () => {
  const v1 = 卡({ id: 'v1', content: [{ content: '可以加 V：abc123 领取教程' }] });
  const v2 = 卡({ id: 'v2', content: [{ content: '请添加威信：abc' }] });
  const v3 = 卡({ id: 'v3', content: [{ content: '扫机器背面的码进去咨询' }] });
  const v4 = 卡({ id: 'v4', content: [{ content: '关注抖音号 abc 看视频' }] });
  const v5 = 卡({ id: 'v5', content: [{ content: '无需添加微信、关注公众号或扫码跳转站外。' }] });
  const v6 = 卡({ id: 'v6', content: [{ content: '机器故障代码E2怎么处理？' }] });
  const items = 巡检.扫引流词([v1, v2, v3, v4, v5, v6]);
  assert.deepEqual(items.map((x) => x.id).sort(), ['v1', 'v2', 'v3', 'v4', 'v5']);
  const 命中 = (id) => items.find((x) => x.id === id).命中.map((h) => h.词);
  assert.ok(命中('v1').includes('加v'));
  assert.ok(命中('v2').includes('威信'));
  assert.ok(命中('v3').includes('背面的码') && 命中('v3').includes('码进去'));
  assert.ok(命中('v4').includes('抖音号'));
  assert.equal(items.find((x) => x.id === 'v5').疑似反向劝阻, true);
  const 上下文 = items.find((x) => x.id === 'v1').命中.find((h) => h.词 === '加v').上下文;
  assert.match(上下文, /加 V/); // 上下文按原文截取（保留空格），便于人工复核
});

test('⑲ 引流词归一化：全角转半角、去空格/连字符/点、小写；映射长度一致', () => {
  const a = 巡检.归一化引流文本('加 Ｖ-信.号');
  assert.equal(a.文本, '加v信号');
  assert.equal(a.映射.length, a.文本.length);
  const b = 巡检.归一化引流文本('ＶＸ');
  assert.equal(b.文本, 'vx');
  // 裸「码」不入词表：快件码/故障代码等正常语境不出候选
  const 正常 = 卡({ id: 'ok', content: [{ content: '取件码哪里看？故障代码E1是什么？' }] });
  assert.equal(巡检.扫引流词([正常]).length, 0);
});
