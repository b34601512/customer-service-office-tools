# 金山在线表格只读读取（kdocs / WPS）

> 场景：别人用分享链接发来的金山表格（如【2026年【报量】表】），匿名打开只能看到表头、看不到单元格；
> 官方 SDK/开放平台要管理权限，**最省事的路子**：让表格里跑一个**只读 AirScript**，本机用 API 调用它取数。

## 文件

| 文件 | 用途 |
| --- | --- |
| `AirScript-只读读取子表.txt` | 粘贴到**目标表格**的 AirScript 编辑器里（只读：只返回单元格，不改任何内容） |
| `读取金山子表.cjs` | 本机 CLI：POST 调用该脚本，取回子表数据（可存 JSON） |

同类的写入型脚本实例见 `../../12.店铺指标数据自动更新/src/kdocsSync/AirScript-写入数据源.txt`（那份会写表格，本目录这份**只读**）。

## 操作步骤（一次配置，长期可用）

1. 打开目标表格 → 顶部「效率」/「工具」→ **AirScript** 打开脚本编辑器；
2. 把 `AirScript-只读读取子表.txt` 全文**粘贴**进去 → **保存**（点 ▶ 直接跑一次也行，默认读最后一张子表）；
3. 在 AirScript 面板里创建/复制**「API 地址」**（形如 `https://www.kdocs.cn/api/...`）和**「令牌 Token」**；
4. 把 API 地址给你要用的人/脚本；令牌只放在本机环境变量里，**不要提交仓库、不要写进笔记**。

```powershell
$env:KDOCS_AIRSCRIPT_TOKEN = "<令牌>"
node .\读取金山子表.cjs --webhook "<API 地址>" --sheet "2026-9" --out "报量表-2026-9.json"
node .\读取金山子表.cjs --webhook "<API 地址>" --operation list_sheets      # 先看有哪些子表
```

## 调用约定（与 12号 写入脚本一致）

- 请求：`POST <API地址>`，头 `AirScript-Token: <令牌>`，体 `{"Context":{"argv":{...}}}`；
- 脚本里用 `Context.argv.*` 取参数；`return` 的对象会被作为结果返回；
- 本脚本参数：`operationType`（`read_sheet` / `list_sheets`）、`sheetName`、`maxRows`（≤3000）、`maxColumns`（≤80）、`requiredScriptVersion`。

## 边界

- 只读：不写单元格、不 `Save()`；表格数据属于公司内部数据，**只本地留档，不外传**；
- 令牌等同表格读取权：只给拿到授权的人，发现泄露立刻在表格里重新生成；
- 读不到时先看返回的报错原文（地址/令牌/`return main()` 是否漏了），不要反复重试。
