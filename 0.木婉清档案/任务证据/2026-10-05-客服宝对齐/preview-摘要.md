# 预览摘要 · 客服宝话术 → SoftTalk 集0「客服宝话术」（2026-10-05 11:20）

## 结论：卡在人工审批，尚未执行 apply

- 模式：`overwrite`（覆盖，按「二级分类+问句」匹配），目标 team / 套 0 / Sheet1
- 输入：`客服宝-1547条-转换.xlsx`（sha256 `c1c6f01b…9147`，220019 字节）
- preview 操作：`92cfc251-31c6-4b01-9746-a62e2c9db1d9`（execution_state=complete）
- **preview_fingerprint：`bf21e1d79f3ffcaa6b82f9cab81ca65ea3472778358a2fc579f57bd7c4ec8196`**
- `human_approval_required`：**true**
- `approval_id`：`7985b1d0-5b41-44dd-af14-797664621ef0`
- **审批有效期至：2026-10-05 11:35:06**（15 分钟；过期需重新 preview）
- preview 计划有效期：1 小时（约 12:20）
- `affected_scopes`：["team"]（写授权已有）

## 预览计数（counts）

| 变化 | 数量 | 说明 |
| --- | --- | --- |
| phrase.update | 1069 | 改写已有话术正文（图片/附件保留） |
| phrase.create | 269 | 新增话术 |
| category.create | 43 | 新增二级分类（含「付款/私域/邀评/延保」等新一级下） |
| 合计 total_items | 1381 | 明细只列前 100 条（items_truncated=true） |

未产生写入的 209 行 ≈ 内容与现有相同被跳过（离线对比：同键同内容 227 条，差在内部重复组与换行归一化）。

## 影响解读

- 集 0 现状 1411 条；本计划 = 更新 1069 + 新增 269（不是替换，**零删除**：预览 counts 无 trash/recycle）。
- 新增主要来自分类名分叉：「付款/私域/邀评/延保」在 SoftTalk 集内不存在（集内对应叫「催付/小蟹」，见观察清单）。
- 抽查（导入前现状，phrase search 集0）：Q5L 命中 5 条、国补 5 条、噪音 5 条。

## 待人工动作（GUI）

在 SoftTalk 主程序「审批/待办」里批准 import_plan（标题形如「覆盖导入 客服宝-1547条-转换.xlsx：改写话术 1069，新增话术 269，新增分类 43」）。
批准后执行 apply（任务窗/主窗）：
`import apply --preview-id 92cfc251-31c6-4b01-9746-a62e2c9db1d9 --expected-preview-fingerprint bf21e1d7…`

## 证据文件（本目录）

- `备份-team-导入前.xlsx`：export.run 备份（team 全域 1418 行，sha256 `231a2553…6686`）
- `客服宝-1547条-转换.xlsx` + `转换校验.txt`（0 差异）
- `inspect-回执.json` / `inspect-结果.json`
- `preview-回执.json` / `preview-结果.json`
- `对比-导入前.md`（离线差异统计）
