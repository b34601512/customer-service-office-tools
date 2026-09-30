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
