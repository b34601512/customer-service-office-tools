# 探域平台API/无头执行通用经验

## 适用范围

本文件只描述探域平台的技术操作方法，不包含任何公司、店铺、账号、商品、政策或客服话术。接入新公司时，必须重新核对登录身份、店铺范围、接口响应和业务授权。

## 执行选择

1. 首选直接HTTP API；需要登录态时，用独立浏览器画像以 `headless:true` 承载认证。
2. 无头GUI（页面点击/填写/读取）只用于模拟测试或接口尚未还原的观察，不作为后台配置正式入口。
3. 禁止有头GUI：不得启动可见窗口；不得接管主管正在使用的浏览器。
4. 接口、字段、业务成功码未从当前前端或实际响应核对前，不猜测写入。

## 通用安全流程

```text
确认公司/平台/店铺/授权范围
→ 使用独立登录态只读采集完整现状
→ 记录接口、请求体、响应体和业务成功码
→ 生成before/after计划与私有备份
→ 保存前再次读取并比较before
→ 只写已批准字段
→ 回读完整对象并比较
→ 记录verified或失败证据
```

HTTP 200不等于业务成功；必须检查响应JSON中的业务码。写入接口默认关闭，脚本应通过显式动作参数开启。

## 探域调用模板

使用同目录 `探域API只读调用模板.cjs`。它不写死店铺ID、账号、Cookie或本机路径：

```powershell
node .\通用经验\探域API只读调用模板.cjs `
  --base-url http://agent.tanyuai.com `
  --profile <当前公司独立登录画像> `
  --endpoint /api/<已核实接口> `
  --method GET
```

模板默认从运行环境加载 `playwright-core`；若未安装，可用 `--playwright-core-path <已授权依赖路径>` 或环境变量 `PLAYWRIGHT_CORE_PATH` 指定，不要把本机路径写入分享包。
若运行环境没有Playwright自带浏览器，可增加 `--browser-channel msedge`（或当前环境已安装的浏览器通道）。

POST请求必须把完整请求体放在本地临时文件，通过 `--body-file` 传入；不要把Cookie或Token写入分享包、聊天或日志。

## 已踩过的接口坑（通用，勿回退）

- `POST /api/kbe/v1/knowledge-card/page` **忽略 pageNo/pageIndex**：翻页永远返回第一页（2026-10-01 实测：8 页返回完全相同的前 500 张）。
  全量拉取要一次 `pageSize: 5000`，并且 **results < total 就报错停下**（fail-closed）——不许拿「缺了半库」的列表去判断重复/消失。
- 删除是 `POST /api/kbe/v1/knowledge-card/batch-delete`，body `{cardIds:[…]}`（不存在的 id → “没有可操作的知识卡片”）。
  **不可逆** → 必须「任务文件里 approvedBy（主管/经理）+ 命令行 --allow-delete true」双确认；删后回读「detail 不存在 **且** 全量列表不含该 id」才算成功。
- 接待/拦截类配置：读 `POST /api/shop-config/agent/config/get`、写 `POST /api/shop-config/agent/config/save`（body 形如 `{configs:{"agent.prohibited.words":{item:[…]}}}`）——平台 UI 同款调用**不带 orgId**。
  ⚠ **带 orgId 读这个配置会返回合成的空「默认配置」**（2026-10-01 实测：真店铺 orgId 与不存在的假 orgId 都返空）——核对配置只认**不带 orgId** 的读取。
  写后必须回读逐词比对（含顺序），并先做 1 词受控试写；回滚件（before 快照 + 还原脚本）先备好再动。

## 经验沉淀要求

每个脚本顶部写清：意图、范围、读写级别、验证方式、恢复边界。每次新公司接入，都要保存脱敏的接口证据和本公司私有快照；不要把真实快照回填到通用目录。

需要验证页面模拟时使用同目录 `探域无头模拟测试模板.cjs`，通过问题文件、输入框占位符、回复标记和可选重置接口传参；不得把具体疾病、商品或店铺写进模板。
