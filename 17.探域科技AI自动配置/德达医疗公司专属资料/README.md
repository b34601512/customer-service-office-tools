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
- 通用执行入口见上级 `../通用经验/`；本目录只保留德达业务作业。旧候选脚本统一移至 `D:/备份文件夹/17项目通用候选旧脚本-20260908`，不得作为当前入口。

### 私有业务调用边界

- 自定义Agent、配置和模拟测试统一改用上级通用模板，以参数接入本公司私有登录画像、店铺范围和备份目录。
- 正式发布仍需主管明确确认；本目录中的业务规则、ID、快照和输出不得复制到通用目录。

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

当前目录只保留35个德达业务作业；21个通用候选已移入 `D:/备份文件夹/17项目通用候选旧脚本-20260908`。有头GUI脚本仍在 `D:/备份文件夹/17项目GUI历史脚本-20260907`。通用工具不在本目录重复保存。

| 脚本 | 用途 |
|---|---|
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
