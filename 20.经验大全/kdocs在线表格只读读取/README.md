# 金山在线表格只读读取（kdocs / WPS AirScript）

> 场景：别人用分享链接发来的金山表格（例：【2026年【报量】表】`https://www.kdocs.cn/l/clOELqhcGlbh`），
> 匿名打开只看得到表头、看不到单元格；官方 SDK/开放平台要管理权限。
> **可行路子**：在目标表格里放一个**只读 AirScript**，本机用它的 API 调用取数。
> 更根本的原因见 22号 实测：网页版只加载当前窗口的数据（46503 行的表匿名只读到 29412 行），AirScript 在云端读整表。

## 文件

| 文件 | 用途 |
| --- | --- |
| `kdocs-scripts/AirScript-只读读取子表.md` | 粘贴到**目标表格**的 AirScript 编辑器；只读，只返回单元格 |
| `读取金山子表.cjs` | 本机 CLI：POST 调 API 取回子表数据（可存 JSON，不打印令牌） |
| `tests/airScriptPasteSafety.test.js` | 反向断言：把粘贴踩过的坑锁死（见下） |

## 操作步骤

1. 打开目标表格 → 顶部「效率/工具」→ **AirScript** 编辑器；
2. **Ctrl+A 全选 → 粘贴** `kdocs-scripts/AirScript-只读读取子表.md` 的全文 → **保存**；
3. 在 AirScript 面板拿到 **API 地址**（形如 `https://www.kdocs.cn/api/v3/ide/file/<fileId>/script/<scriptId>/sync_task`）；
4. 本机调用（令牌只放环境变量，不落仓库）：

```powershell
$env:KDOCS_AIRSCRIPT_TOKEN = "<令牌>"
node .\读取金山子表.cjs --webhook "<API地址>" --operation list_sheets
node .\读取金山子表.cjs --webhook "<API地址>" --sheet "2026-9" --out "报量表-2026-9.json"
```

单测：`node --test "20.经验大全/kdocs在线表格只读读取/tests/airScriptPasteSafety.test.js"`

## 实测坑（2026-09-29）

1. **令牌是账号级的**：金山 AirScript 的 Api-Token 同一账号下可跨表格复用——直接借 12号/9号 配置里已配好的令牌调用别的表格 API，实测 HTTP 200。
2. **用 `clip.exe` 复制会毁中文**：`cat 脚本 | clip.exe` 后再粘进金山 → `SyntaxError: Invalid or unexpected token`。要复制就用
   `powershell -NoProfile -Command "Set-Clipboard -Value ([IO.File]::ReadAllText('<路径>'))"`，或干脆用**纯 ASCII 脚本**。
3. **双字符比较会被吃点**（22号实测）：`== != >= <=` 存进去会变形；脚本里一律用 `indexOf(...) + 1` 判包含、用减法判大小，**不用** `===`。
4. **末行必须是顶层 `return main()`**：只写 `main()` 时金山返回 `data.result = null`，看起来"没反应"。
5. 返回结构：`{"data":{"logs":[...],"result":<脚本返回值>},"error":"..."}`；`result` 为 null 时先看 `error` 与 `logs`。

## 边界

- 只读：不写单元格、不 `Save()`、不激活工作表；表格数据属公司内部数据，**只本地留档，不外传**；
- 令牌等同表格读取权：只发给拿到授权的人，泄露就重新生成；
- 读不到先看报错原文（地址/令牌/`return main()`），**不要反复重试**。
