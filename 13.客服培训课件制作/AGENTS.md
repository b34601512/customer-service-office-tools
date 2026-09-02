# AGENTS.md — 13号 客服培训课件制作（AI 自动读取）

> 本文件仅在本目录（及其子目录）工作时生效。新链路优先；旧方法见「历史资料备份」。

## 本目录是什么

客服培训课件制作。**新做法 = AI 驱动流水线**：机械步骤（取数/渲染/自检）由程序完成，AI 只做"解析内容"创作，全程用命令调用、无界面。**做法以 SKILL.md 为准**。

## 新链路（四步，见 SKILL.md）

```
1. 取数（程序）：node src/cli.js fetch:list / fetch:save（京东抓取，需已登录 Chrome + 调试端口9222）
                或 node src/cli.js import <文件>（手动导入）→ runtime/chat/<基名>.chat.json
2. AI 读记录、确认教学场景（涨价应对/议价/三通识别/安抚情绪…）
3. AI 按 SKILL.md 契约写 runtime/review/<基名>.review.json（唯一创作部分）
4. 出片自检（程序）：node src/cli.js generate → runtime/outputs/<月份>/<文件名>.html + 铁律自检
```

- 全链路都在 `D:\桌面\办公软件\13.客服培训课件制作\` 目录内跑命令。
- **AI 做步骤 3 时**：只填可变内容（挑点、点评、建议话术），输出严格 JSON 契约；样式与自检程序负责。
- AI 也可直接 require `src/services/*`（同一套业务真源）。
- 铁律（就地 `details.insight`、无目录、无结尾总结卡、客户ID脱敏+眼睛按钮、图片内嵌、去姓名）见 SKILL.md「铁律」。

## 配置

- `runtime/config/config.json`（真值，不入库）：调试端口、页面标题匹配词、接口地址、每页条数；模板 `config.example.json`。

## 旧方法与历史

- 旧 TUI 版（启动 bat 菜单）、旧解析提示词模板、旧脚本、旧成品已归档到 `历史资料备份/TUI版备份/` 等，需要参考旧版式/旧脚本时去那里读，**不再维护、别混用**。
- 千店话术通（京东官方机器人话术自动配置，aics.jd.com）与课件无关，历史实现见 `历史资料备份/scripts/qianDian_tool.js`。
- 知你客服（zhinikefu.com）数据抓取历史经验见 `历史资料备份/经验模板-聊天记录演示制作方法.md` 相关段落。

## 业务数据边界

- 聊天记录、成品 HTML、截图等业务数据只放 `runtime/`（已 gitignore），**绝不入 git 公开仓库**；仓库只收源码与 `*.example.*` 模板。
- 本目录代码按"业务唯一真源"：业务在 `src/services`，命令壳 `src/cli.js` 不含业务逻辑；不搞新旧两套。