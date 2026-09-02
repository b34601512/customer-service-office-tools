# AGENTS.md — 客服主管办公软件仓库级规则（强制，改任何项目前必读）

> 本文件位于仓库根，对**本仓库内所有项目目录生效**（pi/AI 从当前工作目录向上加载 AGENTS.md）。
> 子项目目录内的 AGENTS.md/CLAUDE.md 继续有效，与本文件叠加。

## 强制规则 1：每次改动必须开 GitHub issue（当笔记本用）

改**任何项目、任何功能**前，必须先完成：

1. 在本仓库 GitHub Issues 打开新 issue：https://github.com/b34601512/customer-service-office-tools/issues
2. **一个问题一个 issue**：新问题开新 issue，可以引用旧 issue，不要在一长条里堆不同问题。
3. issue 当笔记本用：改动过程中**随时更新**（避免上下文爆掉遗忘重点），做完一项在验收清单打勾。

推荐命令（命令行即可完成，无需打开网页）：

```bash
# 按模板草稿写好后发布
gh issue create --repo b34601512/customer-service-office-tools \
  --title "你的问题标题" --body-file issues/草稿.md

# 过程中持续更新
gh issue edit <编号> --repo b34601512/customer-service-office-tools --body-file issues/草稿.md

# 查看
gh issue list --repo b34601512/customer-service-office-tools --state open
```

- 本地 `issues/` 目录只放**草稿**；「真源」是 GitHub issue，定稿后必须同步上去。
- 禁止：不写 issue 直接改代码；复用/堆砌旧 issue 讲新问题；改完不更新验收清单。

## 强制规则 2：issue 内容模板（照此写）

```markdown
# 标题（一句话说清问题/意图）

## 意图
（你真正想解决什么；30字内核心观点单独成行）

## 背景
（现状、为什么需要改、相关调用链）

## 验收清单
（做完一个打一个勾，这是判断是否完成的标准）
- [ ] …

## 边界
（哪些东西不能牺牲：如业务数据不入库、不改公共接口、不影响其他项目……）
```

## 强制规则 3：仓库约束（所有项目通用）

- **业务数据不入 git 公开仓库**：账号密码、登录会话、聊天记录、成品 HTML、截图、日志、业务表格只留本地（runtime/outputs/data 等已在 .gitignore），仓库只收源码 + `*.example.*` 模板。
- 提交前自查：`git status` 出现业务数据/敏感配置 → 先按 .gitignore 处理再提交。
- 涉及"UI 与业务分离"的架构约定：业务逻辑放 services/业务真源，界面（GUI/TUI/CLI/Web）只负责输入输出。

## 生效前提（重要）

规则只在 **AI 会话的工作目录位于本仓库内**时才会被加载：

- 开 AI 会话前先 `cd D:\桌面\办公软件`（或进入具体项目目录，如 `D:\桌面\办公软件\13.客服培训课件制作`）。
- 若在别处开会话（如家目录），本文件不会被读到——那时可参考家目录 AGENTS.md 中的通用规则。