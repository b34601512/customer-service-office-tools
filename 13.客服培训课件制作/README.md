# 客服培训课件制作助手（13号项目）

把"聊天记录 → 培训课件 HTML"做成流水线。**取数全自动，AI 只做解析，渲染与自检由程序完成。**

## 新流水线（三步）

```
[步骤1·程序] 取数：从京东抓取 / 手动导入 → 标准聊天记录文件
             runtime/chat/<基名>.chat.json
[步骤2·AI]   读聊天记录 + 场景意图 → 产出"解析数据文件"
             runtime/review/<基名>.review.json   （按 SKILL.md 填写）
[步骤3·程序] 生成课件：读两个文件 → 成品 HTML + 铁律自检
             runtime/outputs/<月份>/<文件名>.html
```

> 说明：AI 全程驱动，但只负责"挑教学点 + 写当时 vs 建议话术"（可变内容）；
> 样式、渲染、格式与铁律自检全部由程序保证。AI 通过 `src/cli.js` 命令或直接 require `src/services/*` 完成全部步骤（唯一业务真源，无界面层）。

## 使用方式（AI 驱动，无界面）

所有命令在 `D:\桌面\办公软件\13.客服培训课件制作` 目录下执行，做法看 **SKILL.md**：

1. 取数：`node src/cli.js fetch:list/fetch:save`（京东）或 `node src/cli.js import <文件>`（手动）。
2. AI 按 SKILL.md 契约写解析文件 `runtime/review/<基名>.review.json`。
3. 出片自检：`node src/cli.js generate`。

## 京东抓取（步骤1·程序）

- 需 Chrome 已登录京东客服后台，并带调试端口启动：
  ```
  chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\<用户>\AppData\Local\Google\Chrome\User Data" --restore-last-session
  ```
- 配置在 `runtime/config/config.json`（调试端口/页面标题匹配/接口地址/每页条数；不入库），模板见 `config.example.json`。
- 抓取接口：`kf.jd.com/chatLog/queryList.action`（单日/窄窗口查询，多页自动翻取）。
- 程序列出会话供你选择；抓完会打印前若干条，**请通读确认会话主题与教学场景匹配**再继续（见铁律 8）。

## 导入聊天记录（步骤1·程序，备用取数）

- **粘贴文本**，每行格式（`|` 或 `｜` 均可，`#`/`//` 开头为注释）：
  ```
  2026-08-05 15:07:34|客户|怎么涨价了
  2026-08-05 15:07:52|客服|您看的哪一款呢
  15:08:04|客户|5升医用        ← 只写时分，自动复用上一条日期
  ```
- **从文件**：支持 `.json`（标准聊天记录 或 京东原始 JSON）、`.txt`/`.md`。

## 架构（业务唯一真源，无界面层）

- `src/services/*`：全部业务真源（纯逻辑，无界面）：抓取、转换、导入、存储、渲染、自检、生成编排。
- `src/cli.js`：命令入口（AI 驱动），只做参数解析与输出，业务全部调用 services。
- `SKILL.md`：AI 指导书（流程四步 + 解析契约 + 铁律 + 验收清单）。
- 规则文件：`runtime/config/config.json`（真值，不入库）；`config.example.json` 为模板。
- 原 TUI 版（启动 bat 菜单）已归档至 `历史资料备份/TUI版备份/`，不再维护。

## 铁律速览（AI 制作解析时务必遵守）

1. 所有解析必须用 `<details class="insight">` 就地嵌在对应消息**正下方**、点击才展开；**不要**独立结尾总结卡片、**不要**加目录/锚点栏。
2. 消息顺序 = 真实对话顺序；客服蓝右、客户白左。
3. 转义时把 `<br/>` 还原为换行，**不要**出现字面 `<br/>` 或乱码 `�`。
4. 客户 ID/pin 默认脱敏（程序已用 `.cid` + 眼睛按钮处理），不要在别处写死真实 ID。
5. 去具体客服姓名与"领导要求"等内部措辞。
6. 聊天图片由程序自动下载内嵌；商品链接若消息里含链接，做成"图+标题"可点击卡片（当前版本支持文字/图片，商品卡片为后续增强）。
7. 抓取/导入后先通读确认场景，别硬套。

## 目录

```
（13.客服培训课件制作/ 第一层）
├─ SKILL.md                     # AI 指导书（流程/契约/铁律/验收）
├─ AGENTS.md / README.md
├─ config.example.json          # 配置模板（复制为 runtime/config/config.json）
├─ src/
│  ├─ cli.js                    # 命令入口（AI 驱动）
│  └─ services/                 # 业务真源（无界面）
│     ├─ paths.js config.js chatSchema.js
│     ├─ jdFetch.js jdConvert.js importers.js
│     ├─ chatStore.js reviewStore.js
│     ├─ renderCourseware.js selfCheck.js
│     └─ courseworkService.js   # 生成编排（单一真源入口）
├─ tests/                       # node --test
├─ runtime/                     # 本地数据（不入库）：chat/ review/ outputs/ config/
└─ 历史资料备份/                # 旧方法/旧脚本/旧成品（本地归档，不入库；含 TUI版备份）
```

## 常见问题

- **连不上调试端口**：确认 Chrome 以 `--remote-debugging-port=9222` 启动且已登录；或被代理拦截，参考 12 号项目 NO_PROXY 处理。
- **查不到会话**：日期跨度别过大（单日/窄窗口）；确认登录的是目标店铺。
- **登录错店铺**：先核对会话内容是否匹配教学场景，别硬套。
