# 探域科技AI自动配置 · 脚本复用库

> 登录态在独立画像 `C:/Users/b3460/.pi-edge-auto`（Edge持久目录，别删）。
> 所有脚本依赖 `playwright-core`，先执行：`cd C:/Users/b3460/.pi-edge-work && npm i playwright-core`
> 脚本里写死的画像路径保持不动，拷走也能跑。

## Cookie直调（免开浏览器）
- 探域 Cookie：`tanyu-group-id / tanyu-agent-account / tanyu-account-id`
- 获取：已登录页按F12→控制台输 `document.cookie`
-  base：`http://agent.tanyuai.com`，仪表盘：`POST /api/data-service/business/compass/summary`
  `{"statType":"natural_day","platform":0,"dimension":"platform"}`
- 店铺详情：`GET /api/gc/agent-personal/getChatbotShopDetailPage?pageNo=1&pageSize=20`
- 商品分组：`GET /api/copilot/product-group/group-list`
- 组内商品：`GET /api/copilot/product-group/list-product?id=分组ID`
- 知识卡：`POST /api/kbe/v1/knowledge-card/page {"pageNo":1,"pageSize":5}`
- 学习进度：`GET /api/copilot/product-learning/config/page?pageNo=1&pageSize=30`

## 脚本对照表（scripts/）
| 脚本 | 用途 |
|---|---|
| control.cjs | 常驻受控Edge（独立窗不关，5秒写一次status.json） |
| verify.cjs | 一次性验证：标题/URL/调summary/截图dashboard.png |
| survey.cjs | 采集：Builder+数据罗盘截图，进集团与店铺页 |
| authcheck.cjs | 店铺管理→店铺列表截图+文本（查授权三列） |
| simtest.cjs | Agent Builder模拟买家提问并抓回复 |
| ailearn.cjs / ailearn2.cjs | 商品列表全选→添加AI商品学习→点确定（两页） |
| prodstatus.cjs | 统计两页“学习中/普通商品”数量 |
| cfgcheck.cjs / policycheck.cjs | 欢迎语/卖点/触发器/兜底/拦截/记忆/场景库逐项抓文本 |
| reccheck.cjs / recsub.cjs | 接待设置/协作子项（会话周期/转交话术/称呼/亮灯/抢话/自动发送/标识） |
| shot3.cjs | 自动发送/抢话/欢迎语截图 |
| fix2.cjs | 改自动发送+防止抢话（注意：需复核是否落盘） |
| hsjc.cjs | 话术拦截页抓取 |
| strat.cjs / bind*.cjs | 新建全自动策略→绑定用户弹窗探查（未保存，需用户定绑定账号） |
| feishu.cjs / feishu2.cjs | 飞书密码文档解锁（密码见密码本，不入库） |

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
