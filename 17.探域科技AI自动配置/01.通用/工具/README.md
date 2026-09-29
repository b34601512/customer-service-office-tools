# 通用工具柜

目标：让弱AI不理解旧项目历史，也能按固定流程安全执行。

## 核心链路

```text
后台快照
  ↓
公司业务规则JSON
  ↓ 规则任务生成器.cjs
before/after任务JSON
  ↓ 探域知识卡任务执行器.cjs
检查 → 写入 → 回读核验
```

## 1. 规则任务生成器

用途：离线把“当前快照 + 某公司业务规则”转换成具体知识卡任务，不访问后台。

```powershell
node .\规则任务生成器.cjs `
  --snapshot "当前知识卡快照.json" `
  --rules "公司规则任务.json" `
  --output "待执行任务.json"
```

规则格式参考 `../模板/规则任务.example.json`。

生成后先人工/AI检查before、after和范围，再进入执行器。

## 2. 探域知识卡任务执行器

默认只检查：

```powershell
node .\探域知识卡任务执行器.cjs `
  --task "待执行任务.json" `
  --base-url "当前探域后台地址" `
  --profile "当前公司的已登录浏览器画像" `
  --backup-dir "本次私有备份目录" `
  --action check
```

明确获授权后才写：

```powershell
node .\探域知识卡任务执行器.cjs `
  --task "待执行任务.json" `
  --base-url "当前探域后台地址" `
  --profile "当前公司的已登录浏览器画像" `
  --backup-dir "本次私有备份目录" `
  --action apply `
  --allow-write true
```

只核验目标状态：把 `--action` 改成 `verify`。

执行器会：保存before、检查范围、识别已完成、拦截并发修改、写前再读、写后回读并保存日志。

**业务字段（绑店/范围等）默认不许改**：只有任务文件同时带 `businessPatch` + `approvedBy`（确认的客服主管/经理姓名），
且命令行显式加 `--allow-business-change true`，才允许改；只允许业务字段（`id`/`content` 只能走 `after`），
写入后按“补丁后的期望值”回读核对（绑店列表 + 正文 SHA）。单测：

```powershell
node --test ".\测试\知识卡任务执行器.test.js"
```

## 3. 图片定点编辑器

用途：把“遮哪里、改什么字”留在公司任务JSON，把编辑算法通用化。

```powershell
python .\图片定点编辑器.py `
  --task "图片任务.json" `
  --output-dir "输出目录"
```

格式参考 `../模板/图片定点编辑任务.example.json`。

它不会覆盖源图，并检查修改区域外像素不变。

## 其他平台工具

- `探域只读批量调用.cjs`：一次浏览器会话里跑多条**只读**查询（对账、回读核对、接口探测），默认只允许 GET，POST 需 `--allow-post true`。
- `探域API只读调用模板.cjs`
- `探域自定义AgentAPI模板.cjs`
- `探域配置同文回读模板.cjs`
- `探域无头模拟测试模板.cjs`
- `执行方式审计模板.cjs`
- `文本规则审计模板.cjs`

这些工具仍需按当前后台验证接口和字段，不能因为文件存在就默认接口永久有效。

无头模拟测试如果发现页面发送请求缺少智能体或店铺字段，应显式传入本次现场已核实的
`--bot-id` 与 `--third-shop-id`；工具只在测试请求层补齐字段，不修改生产配置。

## 通用工具必须满足

- 不写死公司、店铺、型号、正文、对象ID、账号和本机路径。
- 默认只读；写入动作必须显式指定。
- 输入来自本次任务参数或业务专用区。
- 发现当前状态与计划before不一致时停止，不强行覆盖。
- 重复执行能识别目标已完成。
- 输出明确状态，不把草稿、保存、核验混报。

公司专用区只保留具体业务正文、型号结论、活动规则、真实ID、图片坐标和任务参数，不再复制执行代码。

## 3. 探域建卡（新建 SHOP 卡片）

用途：把**详情页/客服口径**里的事实写成新知识卡（只新建，不删除、不改既有卡）。

```powershell
node .\探域建卡.cjs --base-url http://agent.tanyuai.com --profile "C:/Users/b3460/.pi-edge-auto" --browser-channel msedge `
  --build "卡片标题|店铺ID[,店铺ID]|" --content-file "正文.txt" --out "回读.json"
# 正文用空行分段；也支持 --payload 直接给 {title,content[],thirdShopIds[]}
```

**注意（实测坑）**：新建成功后 `knowledge-card/page` 有 **~10 分钟可见延迟**——回读不到 ≠ 失败（2026-09-29 实测：同一张卡连建 3 次都"成功"，10 分钟后一次冒出 3 张）。写后回读务必**先用 createdAt 排序确认是否已有同名卡**，别急着重发。
