# 给 AI 的解析数据制作提示词（13号课件工作台）

> 用途：AI 读完标准聊天记录文件后，产出"解析数据文件"（`runtime/review/<基名>.review.json`），供程序渲染成培训课件 HTML。
> 你**只负责内容**（挑点、点评、写话术），**不要**写样式/HTML 骨架（程序已内置）。输出必须是下面契约的 JSON。

## 输入

- 标准聊天记录：`runtime/chat/<基名>.chat.json`（字段：`meta{customer,orderId,window,store}` + `messages[{time,role:'customer'|'waiter',text,img?}]`）。
- 场景意图：由主管/人在主菜单选好该课件"教什么"（如 涨价应对/议价/三通识别/安抚情绪）。

## 输出（严格契约）

```jsonc
{
  "format": "courseware-review/1",
  "scenario": "涨价应对",          // 场景名，用于文件名
  "title": "老客户一句“怎么涨价了”，怎么接住？",
  "sub": "案例看点：不直接承认涨价……（可含 <br/>）",
  "tagline": "客服培训 · 老顾客涨价敏感场景",
  "window": "2026-08-05",
  "store": "dedakj自营",
  "outputName": "涨价应对案例演示.html",

  // overlays：按消息下标挂载标记与解析。i 对应 chat.json messages 的下标。
  "overlays": [
    { "i": 3, "bad": true, "insight": "r1" },                 // 标记"◆可优化回复"并挂解析块
    { "i": 5, "note": "价格敏感", "bad": true, "insight": "r3" } // 加节点小标签
    // { "i": 2, "textOverride": "（脱敏/改写的文本）" }       // 需要改写原文时用
  ],

  // insights：每个被引用的解析块，是 <details class="insight"> 结构（可加 speech-insight 等副类）。
  "insights": {
    "r1": "<details class=\"insight speech-insight\" id=\"r1\">…</details>"
  }
}
```

解析块内部推荐结构（直接套用）：
```html
<details class="insight speech-insight" id="r1">
  <summary><span class="sum-ico">🔥</span><span class="sum-main">标题</span><span class="sum-hint">点击展开</span></summary>
  <div class="insight-body">
    <div class="compare">
      <div class="col bad"><div class="col-label"><span class="ico">✖</span> 当时客服这么回</div><p>原文</p><div class="why">为什么不对</div></div>
      <div class="col good"><div class="col-label"><span class="ico">✔</span> 建议这样回</div><p>建议话术（可含 <b>重点</b>）</p></div>
    </div>
    <div class="arrow-note">要点说明</div>
    <ul class="tips"><li><span class="num">+</span><span>补充话术/赠送配件等</span></li></ul>
  </div>
</details>
```

## 铁律（制作时逐条对照）

1. 每个解析 `details` 只对应**一条**消息，挂在它正下方；**不要**做独立结尾总结卡片、**不要**加目录/锚点栏。
2. 消息顺序 = 真实对话顺序（overlays 只挂下标，不改顺序）。
3. 原文里的 `<br/>` 表示换行，保留语义即可；**不要**让内容出现字面 `<br/>` 或乱码 `�`。
4. 别写具体客服姓名、别写"领导要求"等内部措辞（客户 ID 程序已默认脱敏）。
5. 只对"值得教学"的消息挂解析（一般每课件 2~4 个即可），别每条都挂。
6. `bad` 的解析必须有 `insight`；`i` 必须在消息范围内且不重复。

## 完成后

把 JSON 保存为 `runtime/review/<与聊天记录同基名>.review.json`，然后在程序主菜单选「3 生成课件」即可出片并自检。
