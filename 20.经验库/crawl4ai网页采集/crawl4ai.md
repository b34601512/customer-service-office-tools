# crawl4ai（LLM 友好网页采集）

> 本文件是**入口笔记**：先记录"解决什么问题 + 来源原帖核实 + 链接 + 已验证信息"，后续使用经验再往下追加。

## 一、它解决什么问题

**核心问题：网页抓下来了，但内容太脏、太乱，喂给 AI 不好用。**

它把网页直接变成干净、结构化的 Markdown（标题/表格/代码/引用都在），供 RAG、Agent、数据管道直接用。
（原文：`Crawl4AI turns the web into clean, LLM ready Markdown for RAG, agents, and data pipelines.`）

具体替代掉的麻烦事：

| 麻烦事 | 它怎么做 |
| --- | --- |
| 抓下来的 HTML 一堆导航/广告/脚本噪声 | 启发式 + BM25 过滤，只留正文（Fit Markdown） |
| 要的是结构化字段而不是整页文字 | schema / CSS / XPath 抽取，或交给 LLM 按 schema 出 JSON |
| 页面是 JS 渲染、懒加载、无限滚动 | 内置浏览器（Playwright），自动等渲染、滚到底 |
| 被反爬、要登录态 | Stealth 模式、持久化浏览器画像（Cookie/登录态）、代理 |
| 爬一批页面跨会话要重来 | 会话管理、缓存、断点续爬（resume_state） |
| 想给别人调用而不是本机脚本 | Docker + FastAPI 服务，带 JWT 鉴权 |
| 想要 LLM 直接读网页内容 | 输出 Markdown / 引用编号列表，天生适配大模型上下文 |

**它不解决的**：不是"绕过一切风控"的银弹；不承诺站点改版后你的选择器/流程自动适配；不做业务逻辑（你的表格、排班、店铺指标这些仍要自己写）。

**附带解决的问题（本次收藏的真实动机）：** 免掉爬虫服务月费。自托管开源版不用 key、不用注册、不按页计费。

## 二、来源原帖说法 vs 核实（X 帖子，2026-09-13 记录）

> 原帖要点：作者被某爬虫服务收 16 刀/月，气到自己写了个开源版扔上 GitHub；任何网址丢进去吐干净 Markdown，LLM 直接吃；不用 key、不用注册、不按页算钱，速度比用过的付费还快。

| 原帖说法 | 核实结果 |
| --- | --- |
| 被 16 刀/月的服务逼出来的 | ✅ 作者自述吻合：2023 年要「网页转 Markdown」，那个「开源」方案要账号 + API token + $16，效果还差 |
| 不用 key、不用注册 | ✅ 自托管版成立（README：zero keys / `anyone can use it without a gate`）。⚠️ 但官方另在推 **Crawl4AI Cloud API**（封闭测试，计费未公开），别把它当成永远不存在付费 |
| 不按页算钱 | ✅ 自托管无计量 |
| 速度比付费还快 | ⚠️ 未实测。官方卖点是 async 浏览器池 + 缓存，但快慢取决于目标站点 |
| 五万一千星 | ⚠️ 帖子较早。2026-09-13 实际约 **8.29 万**星 |
| 「付费墙背后才是完整信息」的幻觉碎了 | ❌ 不要误读：它不破解内容付费墙，只免掉「爬虫服务」的月费 |

## 三、链接

- 仓库：<https://github.com/unclecode/crawl4ai>
- 官网/文档：<https://crawl4ai.com>
- Discord：<https://discord.gg/jP8KfhDhyN>

## 四、已验证信息（采集于 2026-09-13，来源 GitHub API / 官方 README）

| 项 | 值 |
| --- | --- |
| 一句话定位 | 开源、对 LLM 友好的网页爬虫 / 抓取器 |
| 语言 | Python |
| 许可证 | Apache-2.0 |
| 最新 Release | v0.9.3（2026-08-31 发布，安全修复版，无破坏性变更） |
| Star 数 | 约 8.29 万 |
| 最近提交 | 2026-09-09（main 分支活跃） |
| 快速上手 | `pip install -U crawl4ai` → `crawl4ai-setup` → `crawl4ai-doctor`，依赖 Playwright Chromium |

## 五、判据：什么时候不值得用（16 号项目实测评估，2026-09-13）

> 结论：**用 crawl4ai 换掉 16 号项目的采集内核，不值得。** 理由见下表。

| 判据 | 事实 |
| --- | --- |
| 目标站自己有 JSON 接口 | 16 号项目已在读 BOSS 自己的 `joblist` XHR 响应体；把接口数据降级成抓 HTML 再解析，是倒退 |
| 交付物是免安装 EXE | 16 号项目只 3 个依赖（requests / openpyxl / websocket-client），单文件 10.47 MB；crawl4ai 实测依赖 **35+ 包**（playwright、patchright、litellm、numpy、nltk、shapely…，见 PyPI 元数据），PyInstaller 单文件会涨到百 MB 级且易碎 |
| 需求是单个字段 | 只要「公司全名」，现有 HTMLParser 约 30 行就够，引入整套框架是负担 |
| 风控/超时不是它治 | 它内部同样是 Playwright 导航；16 号项目遇到的验证/超时问题换它不会自动消失 |

**反向：什么时候值得用**——目标是「网页 → 干净内容喂 LLM」（RAG、Agent 取数）、或要批量深爬一个无接口的站点（去噪、无限滚动、懒加载、断点续爬）。

### 若真要用，两个关键能力（已读源码/文档确认）

- **挂到已开的登录浏览器**：`BrowserConfig(browser_mode="custom", cdp_url="ws://127.0.0.1:9222/devtools/browser/...")`，复用真人画像与登录态。
- **能拿到 XHR 响应正文**（不只是元数据）：`CrawlerRunConfig(capture_network_requests=True)`，`result.network_requests` 的 response 事件带 `body.text`（源位置：`crawl4ai/async_crawler_strategy.py` 的 `handle_response_capture`）。

## 六、待补充（用过后再写）

- [ ] 最小可运行示例（`AsyncWebCrawler` 抓一页 → Markdown）与实测耗时
- [ ] 与现有做法（Playwright / requests+解析）的对比：什么场景值得换过来、什么场景不值得
- [ ] 常见坑（反爬、超时、内存占用、依赖体积）

## 七、边界

- 只做采集，不写入目标站点；不保存、不打印 Cookie/token。
- 未实测前不写"用法经验"，避免把猜的内容当结论。
