# 客服培训课件制作助手（13号项目）

把"聊天记录 → 培训课件 HTML"做成流水线。**取数全自动，AI 只做解析，渲染与自检由程序完成。**

## 新流水线（三步）

```
[步骤1·程序] 取数：从京东抓取 / 手动导入 → 标准聊天记录文件
             runtime/chat/<基名>.chat.json
[步骤2·AI]   读聊天记录 + 场景意图 → 产出"解析数据文件"
             runtime/review/<基名>.review.json   （按「给AI的解析提示词模板.md」填写）
[步骤3·程序] 生成课件：读两个文件 → 成品 HTML + 铁律自检
             runtime/outputs/<月份>/<文件名>.html
```

> 说明：AI 不再每次全程陪跑，只负责"挑教学点 + 写当时 vs 建议话术"（可变内容）；
> 样式、渲染、格式与铁律自检全部由程序保证。AI 也可不经界面，直接调用 `src/services/*` 完成步骤 2/3（与 TUI 同一套业务真源）。

## 使用方式

1. 双击 `启动课件制作助手.bat` 打开控制台。
2. 主菜单选 **1 从京东抓取** 或 **2 导入聊天记录** 取数。
3. 让 AI 按解析提示词模板填好 `.review.json`。
4. 主菜单选 **3 生成课件**，程序出片并打印自检报告。

## 京东抓取（步骤1·程序）

- 需 Chrome 已登录京东客服后台，并带调试端口启动：
  ```
  chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\<用户>\AppData\Local\Google\Chrome\User Data" --restore-last-session
  ```
- 首次可在「5 设置」里配好调试端口/页面标题匹配/接口地址，之后不用每次提供。
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

## 架构（UI 与业务分离）

- `src/services/*`：全部业务真源（纯逻辑，不含界面）：抓取、转换、导入、存储、渲染、自检、生成编排。
- `src/tui/*`：薄壳，只负责菜单/输入/输出，业务全部调用 services。
- 未来 AI 无界面自动运行 = 直接 require `src/services/courseworkService.js` 等，与 TUI 走同一套逻辑。
- 规则文件：`runtime/config/config.json`（真值，不入库）；`config.example.json` 为模板。

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
├─ 启动课件制作助手.bat
├─ AGENTS.md / README.md / 给AI的解析提示词模板.md
├─ config.example.json          # 配置模板（复制为 runtime/config/config.json）
├─ src/
│  ├─ startTui.js               # TUI 入口（薄壳）
│  ├─ tui/ui.js                 # 输入输出原语
│  └─ services/                 # 业务真源（无界面）
│     ├─ paths.js config.js chatSchema.js
│     ├─ jdFetch.js jdConvert.js importers.js
│     ├─ chatStore.js reviewStore.js
│     ├─ renderCourseware.js selfCheck.js
│     └─ courseworkService.js   # 生成编排（单一真源入口）
├─ tests/                       # node --test
├─ runtime/                     # 本地数据（不入库）：chat/ review/ outputs/ config/
└─ 历史资料备份/                # 旧方法/旧脚本/旧成品（本地归档，不入库）
```

## 常见问题

- **连不上调试端口**：确认 Chrome 以 `--remote-debugging-port=9222` 启动且已登录；或被代理拦截，参考 12 号项目 NO_PROXY 处理。
- **查不到会话**：日期跨度别过大（单日/窄窗口）；确认登录的是目标店铺。
- **登录错店铺**：先核对会话内容是否匹配教学场景，别硬套。
