#!/usr/bin/env node
// G-核销：反审 P1/P2 落地后核销清单条目（0.木婉清档案/探域反审清单.json）。
// 规则（按任务书）：
//   ① 确实由本次收紧卡引起的「待主管」条目 → 已处理（根因：P1-<卡id>）；
//   ② 卡已被商品学习重建、无卡可改的 → 留「待主管」并写理由；
//   ③ 待核卡（6a9a3266）核过无时长句（误归因）→ 留「待主管」并写理由；
//   ④ 9a0c 两条原「物流/礼包句在P1」由其前置任务暂闭 → 更新为「已按P1收紧」（不改闭/开状态）。
// 同步重算 处理进度 / 按桶进度 / 更新。
'use strict';
const fs = require('fs');
const 清单路径 = 'D:/桌面/办公软件/0.木婉清档案/探域反审清单.json';
const 清单 = JSON.parse(fs.readFileSync(清单路径, 'utf8'));

const 已处理新 = {
  '6abe23359bb5d85e7b8b10af': '已处理（根因：P1-6abe23359bb5d85e7b8b10af（去「1台顶4台」；「顺丰24小时速发」→「物流：顺丰发货，具体以实际物流为准」））',
  '6abb4427908ac50ae9029a18': '已处理（根因：P1-6abb4427908ac50ae9029a18（规格表去「顺丰速发」））',
  '6abb4404908ac50ae90299d6': '已处理（根因：P1-6abb4404908ac50ae90299d6（删「退换货/质保/维修」段，政策走标准卡））'
};
const 留待主管 = {
  '6abe23359bb5d85e7b8b10aa': '待主管（P1：6abe23359bb5d85e7b8b10aa 已被商品学习重建（旧卡已不在库），无卡可改；相关句走 P4 不可信卡监视）',
  '6a9a32665680f7693636d477': '待主管（P1 已核：6a9a32665680f7693636d477 正文无时长句（trace ifQuote:false，误归因）；72小时句来自 P4 不可信商品卡/生成层）'
};
const 更新暂闭 = {
  '6abb4405908ac50ae9029a0c': '已处理（124口径（365天照实说）；物流/礼包句已按 P1-6abb4405908ac50ae9029a0c 收紧）'
};

const 改动 = [];
for (const it of 清单.items) {
  const target = it.根因 && it.根因.卡;
  if (已处理新[target] && it.状态.startsWith('待主管')) {
    改动.push({ 序号: 清单.items.indexOf(it), 卡: target, 前: it.状态, 后: 已处理新[target] });
    it.状态 = 已处理新[target];
  } else if (留待主管[target] && it.状态.startsWith('待主管')) {
    if (it.状态 === 留待主管[target]) continue;
    改动.push({ 序号: 清单.items.indexOf(it), 卡: target, 前: it.状态, 后: 留待主管[target] });
    it.状态 = 留待主管[target];
  } else if (更新暂闭[target] && it.状态.includes('物流/礼包句在P1')) {
    改动.push({ 序号: 清单.items.indexOf(it), 卡: target, 前: it.状态, 后: 更新暂闭[target] });
    it.状态 = 更新暂闭[target];
  }
}

const 计数 = {};
const 桶计数 = {};
for (const it of 清单.items) {
  const k = String(it.状态 || '').replace(/（.*$/s, '');
  const bucket = it.桶 || '(无)';
  计数[k] = (计数[k] || 0) + 1;
  桶计数[bucket] = 桶计数[bucket] || {};
  桶计数[bucket][k] = (桶计数[bucket][k] || 0) + 1;
}
清单.处理进度 = { 已处理: 计数['已处理'] || 0, 待主管: 计数['待主管'] || 0, 存疑: 计数['存疑'] || 0, 无需处理: 计数['无需处理'] || 0 };
清单.按桶进度 = 桶计数;
清单.更新 = new Date().toISOString();
fs.writeFileSync(清单路径, JSON.stringify(清单, null, 1), 'utf8');

console.log(JSON.stringify({ 改动条数: 改动.length, 处理进度: 清单.处理进度 }, null, 1));
for (const c of 改动) console.log(`#${c.序号} [${c.卡}]\n  前: ${c.前}\n  后: ${c.后}`);
