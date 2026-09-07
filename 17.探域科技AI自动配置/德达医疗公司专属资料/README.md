# 探域科技AI自动配置 · 脚本复用库

> 2026-09-05最新入口：[本次审核报告](./问答审核报告-20260905.md)、[待拍板索引](./待拍板-20260905/拍板索引.md)。旧数量、旧平台描述及旧待拍板事项仅作为历史，勿直接重导入旧话术。
> 本次脚本统一无头运行；原卡完整备份和执行日志在 `D:/备份文件夹/探域问答审核-20260905`。不要盲目重跑历史删除、学习或可见浏览器脚本。

> 登录态在独立画像 `C:/Users/b3460/.pi-edge-auto`（Edge持久目录，别删）。
> 所有脚本依赖 `playwright-core`，先执行：`cd C:/Users/b3460/.pi-edge-work && npm i playwright-core`
> 脚本里写死的画像路径保持不动，拷走也能跑。

## 执行规则与脚本意图（当前唯一入口）

- **禁止有头GUI**：不得启动可见浏览器/窗口，不得用鼠标键盘点击、填写、按键、截图完成后台操作。
- **允许无头/API**：优先使用直接HTTP API；登录态或接口必须依赖浏览器时，可用独立画像的 `headless:true`。无头页面控件操作仅限模拟测试，不作为后台配置正式入口。
- 每个脚本必须在文件顶部写明：意图、范围、读写级别、验证方式、可恢复边界；脚本名只作索引，不能代替意图。
- 默认只读；写入脚本必须显式动作参数，并在写入前备份、写入后回读；发布/发送等外部动作仍须本次明确授权。
- 详细索引见 `scripts/intent-index-20260908.json`；历史有头GUI脚本仅存于备份目录，不得作为当前经验。

### API/无头路线

- 自定义Agent：使用 `scripts/custom-agent-api-20260907.cjs`。
- `--action list` 读取店铺Agent列表；`--action detail --id ID` 读取正文。
- `--action save-draft --id ID --content-file FILE --expected-sha256 SHA` 保存草稿并回读校验。
- `--action publish --id ID --content-file FILE --expected-sha256 SHA` 发布正式版本并回读校验；发布前必须有主管确认。
- 接口：`GET /api/copilot/v1/agent/customized-agent/list|detail`，`POST .../save-content|publish`。
- 登录态只从独立本机画像携带，脚本不输出Cookie；保存前快照在 `D:/备份文件夹/探域问答审核-20260907-custom-agent`。

## Cookie直调（免开浏览器）
- 探域 Cookie：`tanyu-group-id / tanyu-agent-account / tanyu-account-id`
- 获取：不手工复制Cookie；无GUI脚本从独立本机登录画像以 `credentials:'include'` 携带登录态。
-  base：`http://agent.tanyuai.com`，仪表盘：`POST /api/data-service/business/compass/summary`
  `{"statType":"natural_day","platform":0,"dimension":"platform"}`
- 店铺详情：`GET /api/gc/agent-personal/getChatbotShopDetailPage?pageNo=1&pageSize=20`
- 商品分组：`GET /api/copilot/product-group/group-list`
- 组内商品：`GET /api/copilot/product-group/list-product?id=分组ID`
- 知识卡：`POST /api/kbe/v1/knowledge-card/page {"pageNo":1,"pageSize":5}`
- 学习进度：`GET /api/copilot/product-learning/config/page?pageNo=1&pageSize=30`

## 脚本对照表（scripts/）

当前目录只保留API/无头脚本；有头GUI脚本已移动到 `D:/备份文件夹/17项目GUI历史脚本-20260907`。无头GUI只保留已验证且暂无等效快速API的血氧承接测试，其余重复脚本留档。

| 脚本 | 用途 |
|---|---|
| custom-agent-api-20260907.cjs | 自定义Agent列表/详情读取、草稿保存、正式发布及回读校验 |
| agent-config-api-read-20260908.cjs | 接待、自动发送、转交话术、触发器、意图和风格配置只读快照 |
| reception-config-api-20260908.cjs | 接待订单判定读取；可选同文保存回读验证 |
| auto-send-api-20260908.cjs | 自动发送方案读取；可选同文写入回读，未经确认不得执行写入 |
| before-transfer-api-20260908.cjs | 转交前话术读取；可选同文写入回读，未经确认不得执行写入 |
| simulation-api-read-20260908.cjs | 模拟上下文/卡片只读读取；不发送消息 |
| audit-custom-agent-risk-20260908.cjs | 当前Agent正文风险关键词审计，只读不改写 |
| validate-sales-draft-20260908.cjs | 本地草案规则验收，不访问后台 |
| simulate-blood-oxygen-recommend-20260907.cjs | 唯一保留的无头GUI血氧承接测试；等待页面生成回复，不改正式配置 |
| apply-*.cjs / confirm-*.cjs | 已核实的知识卡API原位更新 |
| collect-*.cjs / inspect-*.cjs / verify-*.cjs | 已核实的无GUI采集与回读 |

## 飞书教程
- 地址：`https://my.feishu.cn/wiki/IANhwhmQCio7cxkBdBacnVK5nBh`
- 标题：《智能体2026新页面后台（实施版）操作文档》，密码用户保管
- 要点：知识库、调优工坊、自定义Agent；四步：准备店铺→训大脑→全局协助→诊断优化

## 经验索引
- `AI工作手册.md`：项目主手册与已验证接口/脚本入口
- `经验沉淀-2026-09-04.md`：本轮新增的无 GUI 诊断、调优工坊店铺上下文、范围/订单阶段审计和安全流程
- `金山在线Word文档读取经验.md`：KDocs/WPS 在线 Word 的无 GUI 完整读取方法

## 当前结论（2026-09-04）
1. 不自动回复主因：自动发送默认=仅生成不发送；次因：防止抢话=人工优先
2. 26商品已进AI学习，模拟已回通用语
3. 待定：全自动策略绑定哪个子账号；抢话是否切智能体优先；应用授权三列仍“-”
