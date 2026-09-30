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

## 金山文档（共享，2026-09-30）

`金山表/` —— 匿名无头读金山分享链接 + 调文档里已保存的只读 AirScript 脚本（**唯一出处**）。

| 文件 | 作用 |
| --- | --- |
| `读表核心.js` | `创建读表核心({chromium})` → `listSheets / readSheet / readSheets`（含底色） |
| `脚本客户端.js` | `创建脚本客户端({项目根,log})` → `runAirScript`（AirScript-Token + `Context.argv`） |
| `读表命令行.js` / `查询命令行.js` / `筛选命令行.js` | `read-kdocs.js` / `kdocs-query.js` / `kdocs-filter.js` 的 CLI 逻辑 |

- 22/24/25 号原来各有一份逐字相同的这两套（`src/engine/kdocs.js` 205 行、`kdocsAirScript.js` 95 行、`read-kdocs.js` 150 行…），
  现在都只是薄壳；`chromium`、`项目根`、`log` 全部由项目注入（`playwright-core` 在各项目自己的 node_modules）。
- 收拢时顺手统一了 22号 `kdocs-query.js` 的旧写法（`process.exit(0/1)` → `process.exitCode`）：
  2026-09-27 已确认前者在 Node 24 + Windows 会触发 libuv 断言、退出码非 0，让上游误判「查询失败」。
- 测试：`node --test tools/金山表/金山表.test.js`（9 项，含「壳里不许再出现 page.evaluate / chromium.launch / AirScript-Token」的反向断言）。
- 实测：`22号` 里 `node src/tools/read-kdocs.js --list` → 真实对接表列出 12 个工作表、退出码 0。

## 企微通知（共享，2026-09-30）

`27.企业微信机器人/src/企微通知.cjs` —— 企微群机器人 webhook 发送的唯一出处（默认预演、≤2048 字节、真 @ 靠手机号）；
22/24/25 号的 `src/tools/send-wecom-notice.js` 只是薄壳。详见该文件头注释与 `0.木婉清档案/规矩与红线.md` §九。
