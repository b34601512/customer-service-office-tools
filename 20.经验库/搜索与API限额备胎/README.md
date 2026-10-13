# 经验包：检索被弹验证、API 限额——备胎切换术

> **一句话**：`curl` 打搜索会弹人机验证；GitHub 未认证 API 只有 60 次/时（按出口 IP 算，多人共享更惨）。
> 别硬重试——切备胎：DDG HTML 版、页面代理（r.jina.ai）、已登录 CLI。附 DDG 搜索小工具（被风控会自动走代理）。
>
> 用法：把本文件夹交给你的 AI，说「照这个包，把检索/查 API 的备胎接上」。

---

## 一、Bing 弹验证 → 换 DDG HTML 版

- **现象**：`curl "https://www.bing.com/search?q=..."` 前几次能用，之后返回
  「One last step — Please solve the challenge」（人机验证）。
- **做法**：换 `https://html.duckduckgo.com/html/?q=...`（无需 JS）：
  抓 `class="result__a"`（标题+链接）与 `result__snippet`（摘要）。
- **本包工具**：

  ```bash
  bash 工具/ddg搜索.sh "关键词" 8
  ```

  直连被风控（HTTP 202 + `anomaly` 验证页）时，工具会**自动改走 r.jina.ai 代理**。

## 二、GitHub API 60 次/时 → 换页面读法

- **现象**：`curl api.github.com/...` 连查几次后 403：`API rate limit exceeded for <IP>`、
  `X-RateLimit-Remaining: 0`——要等一小时；**按出口 IP 算**，公司/多人共享出口会互相挤掉。
- **先查额度**（不占用次数）：

  ```bash
  curl -s https://api.github.com/rate_limit
  ```

- **备胎三条**：
  1. **页面代理**读正文：`curl -s "https://r.jina.ai/<github 页面链接>"` → 返回 markdown（整贴含评论）；
  2. 浏览器读页（能带登录态）；
  3. 有登录态的 **gh CLI**：`gh api ...`（走认证额度，不和游客挤）。

## 三、给 AI 的执行说明（速查）

1. 搜索被弹验证 → 换 DDG HTML；DDG 也被风控 → 走 `r.jina.ai` 代理或浏览器；
2. GitHub 403 限流 → 先 `rate_limit` 看剩多少 → 改走页面代理 / `gh api`；**别硬重试**；
3. 抓到的原始材料落盘留证（链接+摘要），方便复查。

## 四、包里有什么

| 文件 | 干嘛 |
|---|---|
| `工具\ddg搜索.sh` | DDG HTML 搜索；直连风控自动走 r.jina.ai 代理；链接已从 uddg 跳转参数解码 |

## 五、实测记录（本机，2026-10-13）

- `bash 工具/ddg搜索.sh "github rate limit 60 requests per hour" 6`：

  ```
  （直连被 DuckDuckGo 风控，改走 r.jina.ai 代理）
  - Rate limits for the REST API - GitHub Docs
    https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
  - …（共 6 条，标题＋真实链接均正确）
  （经 r.jina.ai 代理）
  ```

- `curl -s https://api.github.com/rate_limit` 实测：此刻 core `13/60`（已用 47）——共享出口确实挤；
- `curl -s "https://r.jina.ai/https://example.com"` → HTTP 200（页面代理可用）。
