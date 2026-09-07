# 自定义Agent无GUI接口

## 意图

建立自定义Agent的只读、草稿保存、正式发布API路线，后续不再依赖后台GUI摸索。

## 已核实证据

- 目标店铺：德达医疗旗舰店，`thirdShopId=2095398963959042048`。
- 列表：`GET /api/copilot/v1/agent/customized-agent/list`。
- 详情：`GET /api/copilot/v1/agent/customized-agent/detail?id=...`。
- 保存草稿：`POST /api/copilot/v1/agent/customized-agent/save-content`。
- 发布正式：`POST /api/copilot/v1/agent/customized-agent/publish`。
- Agent正文位于 `draftContent.content` / `onlineContent.content`。
- 发布载荷已由前端包核对：`id,content,desc,labelMeta,labelGroupId,tableIds,toolType`。

## 当前采集结果

- 已无GUI读取“售前咨询”和“通用规则”两个Agent。
- 已保存私有快照：`D:/备份文件夹/探域问答审核-20260907-custom-agent/`。
- 售前Agent当前正式规则仍含“血氧/医院档位→升数”的自动推荐链，待主管确认后才能改写。

## 验收清单

- [x] 无GUI读取列表和详情。
- [x] 无GUI核对保存与发布接口及字段。
- [x] 新建API脚本，保存前备份，写入后回读并做正文SHA-256校验。
- [x] 用当前售前Agent原文执行同文草稿保存并回读，正文SHA-256：`82129755f968c94bd219496a4297359f0913970c48ca080ed521d7722eb77c6a`。
- [ ] 以主管确认后的新正文执行一次实际草稿更新并回读。
- [ ] 主管确认后发布正式版本并回读。
- [ ] 正式模拟售前正例、疾病筛查例、急症反例。

## GUI经验清理状态

- [x] 71个有头GUI脚本移至 `D:/备份文件夹/17项目GUI历史脚本-20260907`；保留1个已验证无头血氧测试入口。
- [x] 项目当前脚本目录无有头GUI标记；活动CJS脚本语法检查通过。
- [x] 接待设置、自动发送、转交前话术和模拟器的API/无头测试入口已加入当前脚本目录；策略/触发器/意图无现有规则，不新增。

## 其他配置API探测（2026-09-08）

已无GUI加载18个配置路由并抓到200响应。当前可读接口包括：

- 接待基础配置：`POST /api/copilot/agent/config/list`、`GET /api/shop-config/agent/config/variables/get`。
- 自动发送绑定：`GET /api/shop-config/agent/auto-send-bind/get/plan-detail`。
- 转交前话术：`GET /api/shop-config/v1/agent/before-manual-transfer-rule/get`。
- 策略/触发器：`GET /api/shop-config/v1/agent/smart-trigger-rule/list`、`GET /api/shop-config/agent-consult-intent/list`。
- 售前/售后意图：`GET /api/shop-config/intents/list`。

前端包已发现对应写入口，但尚未以原文同文写入验证，尤其自动发送、接待开关和策略绑定涉及外部行为，必须先取得具体payload并逐项确认。

- [x] 新增 `scripts/agent-config-api-read-20260908.cjs`，11类配置只读快照全部返回HTTP200、业务`code=1`。

只读快照文件：`德达医疗公司专属资料/agent-config-read-20260908.json`。已确认当前后台状态：自动发送有2个方案；转交前话术、智能触发器、意图库、客户风格均为空或默认配置；两个自定义Agent均启用。

已从前端包静态核对到的写接口（仅发现，未执行）：

- 接待/基础：`/api/shop-config/agent/config/save`、`/api/shop-config/agent/config/update-reception`。
- 自动发送：`/api/shop-config/agent/auto-send-bind/batch-save`。
- 转交/触发：`/api/shop-config/v1/agent/before-manual-transfer-rule/save`、`smart-trigger-rule/save|toggle|delete`。
- 意图/风格：`agent-consult-intent/save`、`agent-reply-intent/save`、`intents/save|update|delete`、`customer-style/save|del`。

目前只有自定义Agent完成了“写入→回读→哈希核对”验证；其余接口还缺少从当前原文生成的安全payload，不能猜字段执行。

### 新增静态核验：自动发送

- 前端组件已核对保存调用形态：`POST /api/shop-config/agent/auto-send-bind/batch-save`，请求体为 `{plans: [...]}`。
- 已核对保存前会清理系统账号方案的 `services/serviceGroups`，清理卖家账号方案的 `bindAccounts`；不是简单拼接字段。
- 当前后台读取到2个方案；已按用户授权执行一次同文写入。业务字段回读一致，但后台为两个方案重新生成了 `planId`，因此不能按原始全量SHA判断成功。
- 已修正 `auto-send-api-20260908.cjs`：回读校验忽略系统重建的 `planId`，后续不得重复执行同文测试以避免无必要地重建ID。

### 新增静态核验：转交前话术

- 前端表单初始结构确认包含 `beforeTransferContent` 与 `beforeTransferSpeeches`。
- 每条店铺话术包含 `thirdShopIdList`，保存调用直接提交表单对象到 `.../before-manual-transfer-rule/save`。
- 当前后台为 `{beforeTransferSpeeches: []}`；可生成同文payload，但尚未写入。
- 已新增 `scripts/before-transfer-api-20260908.cjs`；只读运行通过，当前话术数量为0，payload SHA-256：`b31ae02d4d97edcbeb2761c4779d752be64c58e6a323fb1a04c9fd685d3bd515`。
- 已按用户授权执行一次同文保存→回读，验证通过，回读SHA一致：`b31ae02d4d97edcbeb2761c4779d752be64c58e6a323fb1a04c9fd685d3bd515`。

### 新增静态核验：接待订单判定

- 前端确认写接口：`POST /api/shop-config/agent/config/save`。
- 请求体结构：`{orgId: thirdShopId, configs: {"agent.reception.salesStageJudgment": formValues}}`。
- 表单字段为 `consultOrderStrategy`、`preSalesJudgeRange`；当前真实值为 `consultOrderStrategy=1`、`preSalesJudgeRange=15`，未执行写入。
- 已补充并验证读取：`POST /api/shop-config/agent/config/get`，请求体含 `orgId` 与 `metaIds`，用于回读接待配置。
- 已新增 `scripts/reception-config-api-20260908.cjs`；同文保存→回读验证通过，前后均为 `preSalesJudgeRange=15`、`consultOrderStrategy=1`；后续勿重复测试。

### 新增静态核验：智能触发器

- 前端保存字段已还原：`name`、`priority`、`ifAnd`、`filters`、`triggers`、`transferActionDto`、`ifLimit`、`limitMinute`、`limitSendNum`。
- `triggers`提交为 `{type, ...data}`，动作提交为 `{actionType, ...data}`；编辑时由后端详情中的 `triggers/transferActionDto/filters` 反向还原。
- 当前后台触发器总数为0，因此没有可执行的同文写入验证；不得自行新增规则。

### 新增静态核验：意图配置

- 自定义咨询场景保存字段：`intentsName`、`description`、`keywords`，并追加 `intentType: CONSULT`；回复场景为 `intentType: REPLY`。
- 咨询配置保存为配置数组；字段含 `name`、`ifDefault`、`afterSale`、`consultAfterSale`、`disCount`、`negativeEmotions`、`intentIdList`、`thirdShopIds`。
- 回复配置保存为配置数组；字段含 `name`、`noRepeatSendSwitch`、`noRepeatSendNum`、`noRepeatSendRound`、`intentIdList`、`thirdShopIds`。
- 前端提交前把店铺ID转换为 `{thirdShopId}`对象；当前均为默认/空配置，未新增意图或执行写入。

### 新增静态核验：模拟器

- 已还原只读接口：`GET /api/im/agent/debug/get-content?thirdShopId=...`、`GET /api/im/agent/debug/get-card-list?thirdShopId=...`。
- 已新增 `scripts/simulation-api-read-20260908.cjs`，无GUI只读运行通过：当前上下文1条、卡片1条。
- 最新批量复核：模拟只读接口返回上下文10条、卡片10条；无头页面测试入口仍为唯一有效回复验证入口。
- 发送买家消息、重置会话、执行trace属于外部行为，尚未接入可执行入口；需明确测试文本和确认后再做隔离验证。
- 前端已还原模拟买家发送payload：`botId`、`orderStatus`、`thirdShopId`、`sourceType=0`、`customerStyleId`、`customizedAgentModel`、`msgContent:{type:0,value}`；但发送接口仍不纳入只读脚本，避免误发。
- 因授权档案被现有Edge进程锁定，新增只读脚本使用已存在且未锁定的授权快照作为种子；未强停或接触用户当前浏览器进程。

### 新增只读风控审计

- 新增 `scripts/audit-custom-agent-risk-20260908.cjs`，读取“售前咨询”正式/草稿正文并输出哈希与风险命中。
- 当前正文SHA-256：`a1de66de56bb3b7df6ca5d75c24984215e66f875017b093b22277ade3ba046aa`。
- 命中：血氧数值直映、医院档位映射家用流量、疾病直接决定流量；仅标记，不自动改写或发布。
- 本次无GUI模拟提问已成功进入测试会话，但轮询后未出现Agent回复；随后已成功重置测试会话。复核“售前咨询”正式/草稿仍同SHA且命中上述3类风险；“通用规则”正式/草稿SHA为 `e06b1a02028125f0a50dad74e5562a5804252c093251c1eca700ca245348b65e`，未命中本审计规则。
- 已将旧GUI脚本 `simulate-blood-oxygen-recommend-20260907.cjs` 的两条原题迁移至 `simulation-api-test-20260908.cjs`；两条模拟发送均成功，但回读仅见买家消息、未见Agent回复，不能判定问题已解决。

### 2026-09-08无头GUI复测

- 使用已归档的 `simulate-blood-oxygen-recommend-20260907.cjs`，实际为 `headless:true` 的页面自动化；每题等待约30秒后读取页面正文。
- 两题均收到回复：第一题询问基础疾病；第二题给出“无基础疾病1—2升、有基础疾病3升”的条件化建议。
- 因此“模型遇到血氧就只让客户找医生”本次未复现；此前API回读无回复，主要是API测试只读到会话上下文，不能等同页面自动化完成态。
- 仍存在业务风险：回复把93%称为“轻微缺氧”，并按基础疾病直接映射升数；本次仅证明测试链路有效，不代表现行规则已安全或无需调整。
- 脚本已改为测试前后重置模拟会话，并要求问题计数与“参考采纳话术和全店知识生成”回复标记均新增；严格复测两题均独立收到新回复，避免历史上下文误判。

## 边界

- 不关闭医疗风控，不按疾病或单次血氧自动开具流量/浓度/时长处方。
- 不使用或保留后台GUI脚本作为当前操作入口。
- 不发布未经主管确认的业务规则；不输出登录凭据。
