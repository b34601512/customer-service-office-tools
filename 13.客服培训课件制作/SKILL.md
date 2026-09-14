# SKILL.md — 客服培训课件制作（AI 驱动版）

> 这是「13.客服培训课件制作」项目的 AI 指导书。**什么时候用**：老板说"做一份 XX 培训课件"、或要基于聊天记录出教学 HTML。
> 机械步骤全部由本项目的程序（`src/services` + `src/cli.js`）完成，你**只负责内容创作**（挑点、点评、话术）。

## 流程（四步，缺一不可）

```
1 取数 → 2 读记录确认教学场景 → 3 写解析文件 → 4 出片 + 自检 + 验收
```

### 第 1 步：取数（聊天记录）
工作目录：`D:\桌面\办公软件\13.客服培训课件制作\`（所有命令在此目录跑）。

```bash
# 京东抓取（需已登录京东后台 + Chrome 调试端口 9222；日期必填，建议单日/窄窗口）
node src/cli.js fetch:full <顾客ID>                       # 【课件取数用这个】抓全量（含机器人自动回复），列出会话与 sid
node src/cli.js fetch:full <顾客ID> --save <sid> [--tag 主题]  # 保存该会话为聊天记录（含系统/自动回复消息）
node src/cli.js fetch:list --start 2026-08-05            # 只含客服/客户消息（旧口径），仅用于定位 sid

# 或手动导入（聊天记录备份 txt/json）
node src/cli.js import <文件路径>
```

输出会落在 `runtime/chat/<基名>.chat.json`——**这就是标准聊天记录**（`meta{customer,orderId,window,store}` + `messages[{time,role:'customer'|'waiter',text,img?}]`）。

### 第 2 步：读记录、定教学场景
- 通读聊天记录，向老板确认/自己判断**教什么**（如 涨价应对/议价/三通识别/安抚情绪/挽留话术）。
- 记录 `meta.window / meta.store / 场景名`，第 3 步会用到。

### 第 3 步：写解析文件（你唯一要"创作"的部分）
按严格契约写 JSON，保存为 **`runtime/review/<与聊天记录同基名>.review.json`**：

```jsonc
{
  "format": "courseware-review/1",
  "scenario": "涨价应对",            // 场景名
  "title": "老客户一句“怎么涨价了”，怎么接住？",
  "sub": "案例看点：不直接承认涨价……（可含 <br/>）",
  "tagline": "客服培训 · 老顾客涨价敏感场景",
  "window": "2026-08-05",
  "store": "dedakj自营",
  "outputName": "涨价应对案例演示.html",

  // overlays：按消息下标挂标记。i = messages 数组下标，不重复、必须在范围内。
  "overlays": [
    { "i": 3, "bad": true, "insight": "r1" },
    { "i": 5, "note": "价格敏感", "bad": true, "insight": "r3" }
    // { "i": 2, "textOverride": "（脱敏/改写的文本）" }
  ],

  // insights：被引用的解析块，<details class="insight"> 结构
  "insights": {
    "r1": "<details class=\"insight speech-insight\" id=\"r1\">…</details>"
  }
}
```

解析块推荐结构（`insight-body` 内可用 `compare`(bad/good 两栏对比)、`arrow-note` 要点、`ul.tips` 补充话术，可加 `speech-insight` 类；注意转义双引号）：

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

### 第 4 步：出片 + 自检 + 验收
```bash
node src/cli.js generate [聊天文件基名]      # 出片 + 铁律自检，全绿才算完成
node --test                                    # 回归测试（改了本项目代码才需要；Node 24 下目录写法 node --test tests/ 会报 Cannot find module，用这个）
```
`generate` 输出含成品路径（`runtime/outputs/<年>年<月>月/<文件名>.html`）与自检清单。

## 铁律（第 3 步逐条对照，别违反）

1. 每个解析 `details` 只对应**一条**消息；**不要**做独立结尾总结卡片、**不要**加目录/锚点栏。
2. 消息顺序 = 真实对话顺序（overlays 只挂下标，不改顺序）。
3. 原文里的 `<br/>` 表示换行，保留语义；**不要**出现字面 `<br/>` 或乱码 `�`。
4. 别写具体客服姓名、别写"领导要求"等内部措辞（客户 ID 程序已默认脱敏）。
5. 只对"值得教学"的消息挂解析（一般每课件 2~4 个），别每条都挂。
6. `bad` 的解析必须有 `insight`；`i` 不重复且必须在消息范围内。
7. **不要顶部大标题 / 红色摘要卡**（2026-09-14 用户要求）：课件打开即正文（会话回放），标题只放浏览器标签 `<title>`。解析文件里的 `sub`/`tagline` 只当存档备注，渲染器不再输出它们，也不要往 `insights` 里塞标题头/案例看点。
8. **取数必须用含自动回复的全量口径**（2026-09-14 踩坑，务必遵守）：京东聊天记录列表 / `waiterSession/queryChatLog` **只有客服与客户的消息，不含机器人自动回复、欢迎语、商品卡片**。做课件一律用：
   ```
   node src/cli.js fetch:full <顾客ID>                      # 列出全量会话（含自动回复条数）
   node src/cli.js fetch:full <顾客ID> --save <sid> [--tag 主题]   # 保存（文件里带 role=system 消息）
   ```
   - 实现：CDP 驱动页面「填顾客ID → 查询 → 查看」并抓 `api.m.jd.com/client.action?functionId=queryLastLogs`（带 h5st 签名，只能页面自己发）；同顾客重复抓取会自动刷新页面重试。
   - 机器人消息不止 `@im.jd.com`：以店铺账号名义下发、带 `action.code=cfg.welcome.new` 的菜单自动答案也是自动回复（都会被标成 `role:'system'`）。
   - 课件会把系统消息画成**灰色虚线框**（标「自动回复/欢迎语/商品卡片」），自检铁律：系统消息条数必须和记录一致，否则判 fail。
   - 为什么要这样：否则会把「机器人已经答完、客服只是发个表情打招呼」误判成「客服只回了个表情不回答问题」，**误伤客服**；也可能把机器人引导/自动生成的提问当成客户真实提问。

## 验收清单（做完逐项打勾）

- [ ] 聊天记录已存到 `runtime/chat/`（第 1 步输出路径确认过）
- [ ] 教学场景已明确（第 2 步）
- [ ] 解析文件已写且与聊天记录**同基名**（第 3 步）
- [ ] `generate` 自检全绿，成品 HTML 已生成
- [ ] 打开成品人工过一眼：挂点位置对、话术通顺、无乱码
- [ ] 若发现问题，改的是解析文件重跑 `generate`，**不要**手改成品 HTML