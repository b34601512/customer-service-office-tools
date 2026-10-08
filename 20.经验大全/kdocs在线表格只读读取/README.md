# 金山在线表格只读读取（kdocs / WPS AirScript）

> 场景：别人用分享链接发来的金山表格（例：【2026年【报量】表】`https://www.kdocs.cn/l/<示例表分享ID>`），
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

## 越过网页加载截断读大表尾部（2026-10-07 实测）

> 背景：网页版客户端一次只加载约 **100 万格**（例：退货退款表 34 列 → 只加载到 29412 行；全表实际 47807 行）。
> 超过的部分用常规 `getUsedRange().getRangeContents()` 读不到；滚动/键盘/`loadDelayedData` 都逼不出加载。
> **但模型的查询 API 能直接问服务端要任意范围的值**（不用 AirScript、不用登录）：

```js
// 0 基行列；createRANGE 参数序 = (rowFrom, rowTo, colFrom, colTo)；子范围要 createRange() 包一层才有查询方法
const 范围 = sheet.createRange(sheet.createRANGE(29412, 29413, 10, 22)); // 行29413-29414 × K:W
await new Promise((res) => 范围.queryRangeValues((r) => res(r), 3000));
// r.result.values = 稀疏数组：[{row, col, text}, ...]（只回非空格；text = 显示文本）；maxItems 默认 3000，超了就分段查
// 另：sheet.queryRangeFirstRow('K29413:K47804') 直接问「这段里第一个有内容的行」（返回 {firstRow, values}）
```

- 坑：本版模型的 `sheet.getRange()` **不接受字符串/数字参数**（无参 = 整表范围）；字符串范围会被忽略（返回整表元数据）。
- 实测：用它在 7 段 × 3000 格里扫完退货退款表尾部 K 列 18393 格，成功定位 4 个单号（见 `30.检查交接跟进表/runtime/退款表尾部查询2-20261007.json`）。
- 适用面：**任何分享链接**的金山表格（匿名即可）；比“让对方放 AirScript”轻，适合一次性查证。

## 边界

- 只读：不写单元格、不 `Save()`、不激活工作表；表格数据属公司内部数据，**只本地留档，不外传**；
- 令牌等同表格读取权：只发给拿到授权的人，泄露就重新生成；
- 读不到先看报错原文（地址/令牌/`return main()`），**不要反复重试**。
