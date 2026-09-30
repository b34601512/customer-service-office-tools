# tools/ —— 仓库级小工具

## 打码过滤器（2026-09-30）

本仓库是**公开**的（见根 `开源边界.md`），但本地要能用 → 用 git 过滤器两头兼顾：

| 文件 | 作用 |
| --- | --- |
| `打码过滤器.js` | Git clean/smudge 驱动：提交时「真值→打码值」，检出时「打码值→真值」 |
| `打码字典.js` | 打码规则与对照表读写（真值不写在这里） |
| `打码.js` | CLI：`--扫描`（还剩哪些真值）/`--学`（收进对照表）/`--核对`（HEAD 里有没有漏）/`--自检`/`--体检` |
| `打码对照.local` | **本机私有**对照表（`*.local` 已被 .gitignore 排除，不入库） |

本机一次性启用：

```bash
git config filter.打码.clean  "node tools/打码过滤器.js clean"
git config filter.打码.smudge "node tools/打码过滤器.js smudge"
node tools/打码.js --体检
```

日常：写完东西 `node tools/打码.js --扫描` 看有没有新冒出来的真值 → `--学` → 正常提交 → `--核对` 确认 GitHub 那份没漏。

> 早先 `CLAUDE.md` 里写的 `git-secret-filter.js`（清空 kdocs 令牌）从未落地，2026-09-30 已被上面这套取代。

## 浏览器引擎（共享，2026-09-30）

`浏览器引擎/index.js` —— 受控浏览器的「拉起 / 附着 / 关闭」（按店铺 profile 隔离，不含业务判断）。

- **唯一出处**：22/24/25/26 号原来各有一份逐字相同的 209 行 `src/engine/browser.js`，现在都改成薄壳
  `创建({ log, chromium })`；1号 那份不同且用户要求不动，没并进来。
- API：`openStoreBrowser / attachStoreBrowser / probeDebugPort / isPortFree / resolveBrowserPath / portUsesProfileDir / firstPage / sleep`。
- 说明：`chromium` 由调用方注入——`playwright-core` 装在各项目自己的 `node_modules` 里，根目录没有，所以引擎里不做顶层 require。
- 测试：`node --test tools/浏览器引擎/引擎.test.js`（8 项，含「四个壳不许再自带 spawn/execFileSync」的反向断言）。

## 企微通知（共享，2026-09-30）

`27.企业微信机器人/src/企微通知.cjs` —— 企微群机器人 webhook 发送的唯一出处（默认预演、≤2048 字节、真 @ 靠手机号）；
22/24/25 号的 `src/tools/send-wecom-notice.js` 只是薄壳。详见该文件头注释与 `0.木婉清档案/规矩与红线.md` §九。
