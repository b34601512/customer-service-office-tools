# 积分成本优化：自定义Agent 拆分与归位

来源：2026-09-28 用户提供的官方计费规则 + 一次真实整改（见 `02.业务专用/德达医疗/配置变更-积分优化-20260928.md`）。
只讲方法与后台操作，不含任何公司/店铺/商品事实。

## 1. 计费规则（决定优化方向）

| 项目 | 计费 |
| --- | --- |
| 话术生成 & 催一下 | 同一店铺、同一天内，**任一次**话术生成调用了自定义Agent → 该店该天按 **1.5** 积分/次；当天所有生成都没调用 → **1** 积分/次 |
| 商品学习 | 其他平台 1 个 SPU = 10 积分；京东自营 1 个 SKU = 10 积分（只学 1 次） |

关键推论：**代价不在"写了多长"，而在"这次生成有没有被路由到自定义Agent"**。而且粒度是"店铺×天"——
当天只要命中一次，全天所有生成都按 1.5 计。所以目标只有一个：**把"会被路由到 Agent"的对话压到最低**。

## 2. 拆分原则（一个 Agent 只干一件事）

1. **触发场景描述写"买家情形"，不写场景名**；**名称也要具体到一个问题类型**（如「雾化判断」「运费与退换」，而不是「售前咨询」「通用咨询」）。
   - 反例：「售前咨询」「通用咨询」——等于全部放开，普通咨询也会命中。
   - 正例：「买家问该买几升/哪款适合、说出血氧或使用档位时」。必要时列多条情形。
   - 名称按表单说明是"内部展示和管理用"，路由仍由触发场景描述决定；但名称不具体会让人误以为"范围很宽"，也容易漏建/重复建。
2. **一个 Agent 只保留"多轮推进型流程"**（需要按步骤收集信息再给结论的场景，如选型推荐、定制留资、议价）。
   一次性可查的信息（参数、材质、政策、FAQ）都不该进 Agent。
3. **触发范围能收就收**：订单状态（售前/售中/售后）、指定商品或商品组，都是缩小命中面的开关；多个 Agent 的触发描述要互斥。
4. **改前先查重**：知识库/表格知识里已有的内容不要再写进 Agent（本项目实测：2000+ 张卡里运费、雾化、礼品、型号核实都已有卡）。

## 3. 内容归位对照表

| 内容类型 | 落点 | 说明 |
| --- | --- | --- |
| 多轮流程（选型/定制/议价） | 自定义Agent | 只留流程与必要的判断口径 |
| 通用行为约束（不得猜型号、不重复追问、不承诺、不引导外部平台、售后口径） | **自定义风格** | 唯一"对所有回复生效且不按 Agent 计费"的位置 |
| 政策/FAQ/参数（运费、售后、配件、活动） | 知识库 / 表格知识 | 先检索是否已有卡，避免重复投喂 |
| 需要"只生成不发送"的动作 | 话术拦截 / 场景库 | 拦截类不靠 Agent 提示词 |
| 转人工、手动转交、未回复兜底 | 触发器 / 兜底话术 | 与 Agent 解耦 |
| 计算类（报价、单位换算） | 工具（报价计算器 / `@tool{calculate}`） | 不写进提示词 |
| 跨会话信息（车型、度数等） | 记忆 | 减少重复反问 |

## 4. 自定义风格（后台）实操要点

- 路径：Agent Builder → 策略 → 自定义风格 → 新增话术风格。
- 字段与上限：**角色 ≤100 字 / 称呼 ≤100 字 / 详细设定 ≤500 字 / 示例话术 ≤300 字**。
- 必须**绑定客服或客服分组**才会生效；客服绑定多个风格时，按更新时间最新的生效。
- 表单自带一份示例模板（服饰行业），要全部替换成本公司内容再保存。
- 保存接口：`POST /api/shop-config/customer-style/save`；列表：`GET /api/shop-config/customer-style/list`（返回 `role / salutation / setting / example / toServices`）。

## 5. 自定义Agent（后台）实操要点

- 列表：`GET /api/copilot/v1/agent/customized-agent/list`（含 `isRun` 正式版本开关、`draftsIsRun` 草稿开关、`orderStatus`、`relationShop/relationProducts`）。
- 新建/改名：`POST /api/kbe/v1/agent/customized-agent/save`（body 含 `name` + 适用范围/店铺/客服/订单状态；返回新 id；改名时带 `id` + 新 `name`，改完回读列表）。
- 删除：`POST /api/kbe/v1/agent/customized-agent/delete`（body `{id}`；UI 卡片右下角垃圾桶 → 确认框）。**不可回滚**，删前必须：① 把 detail 的 desc/content/orderStatus/relationShop 备份到本地；② 逐条核对内容已被接走（其他 Agent / 自定义风格 / 知识库）；③ 得用户明确同意。
  - **新建出来的 Agent 默认未启用**（`isRun=false`）：发布内容后还要把正式/草稿两个开关都打开才生效。
  - 名称要具体到一个问题类型（如「雾化判断」），不要用「售前咨询」这种大范围名字。
- 详情：`GET /api/copilot/v1/agent/customized-agent/detail?id=...`（`draftContent` / `onlineContent`）。
- 改内容并发布：`POST /api/copilot/v1/agent/customized-agent/publish`，body `{id, content, desc, labelGroupId, labelMeta, tableIds, toolType}`；发布后用 detail 回读 `onlineContent` 比对。
- 启停（两个开关，都要关才算真正停用）：
  - 正式版本：`POST /api/kbe/v1/agent/customized-agent/toggle`，body `{id, isRun}`
  - 草稿版本：`POST /api/kbe/v1/agent/customized-agent/drafts-toggle`，body `{id, isRun}`
  - 只关“正式”不够：草稿开着时仍可能在用草稿内容，改完必须回读列表确认 `isRun=false` **且** `draftsIsRun=false`。
- 工具：`01.通用/工具/探域自定义AgentAPI模板.cjs`（list/detail/save-draft/publish，发布需显式 `--allow-publish true`）。

## 6. 改完怎么验证

1. **状态回读**：Agent 的 `isRun`、`orderStatus`、`relationShop` 是否按预期；风格是否已绑定客服。
2. **效果验证**：用调优工坊「场景回放」验证知识库/自定义Agent/风格改动是否生效（触发器、话术拦截、兜底话术不在回放范围）。
3. **成本验证**：调优工坊按天看生成量（`POST /api/im/agent-trace/paginateV2`，body `{thirdShopId,pageIndex,pageSize,beginTime,endTime}`），配合积分余额 `GET /api/gc/subscription-order/points/usage-status`；出现"当天没有任何 Agent 调用"的日子，才算真的省到。
4. **基线先行**：改动前先记一天的生成量/余额，否则事后无法归因。

## 7. 坑

- 计费是"店铺×天"级：**只要当天有一次 Agent 调用，全天按 1.5**——留着"顺手用一下"的宽触发 Agent，等于全天涨价。
- 触发描述收得太窄会漏推荐：拆分后要按真实对话抽查命中情况（调优工坊）。
- 内容从 Agent 移走后，**要确认落点真的生效**（知识库卡片是否命中、风格是否绑定到客服），否则会出现"规则没人执行"。
- 京东自营按 SKU 计费（一个 SKU = 一个商品链接），学习前先用「禁用AI商品学习清单」+ 商品ID批量禁用控成本。
