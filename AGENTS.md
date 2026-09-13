# AGENTS.md

本仓库的问题与笔记（issue）在这里：https://github.com/b34601512/customer-service-office-tools/issues

## 工作约定（用户要求，2026-09-13）

0. **收工/换班时留断点记录**：把「做到哪、下一步、待用户拍板的事、常用命令」写进仓库根目录 `断点记录.md`（覆盖更新，只留最新一份），下次开工先读它。

1. **每次开始新任务，先拉起一个 loop 托管它**（`LoopCreate`，一般用 `triggerType=idle` + `trigger=idle`，配 `maxFires` 上限与 `expiresIn`），防止会话中断导致任务半途而废。
   - loop 的 prompt 里写清：目标、每轮做什么、自检/验收命令、提交推送方式、**哪些事必须停下来问用户**。
   - 每轮唤醒结束用 `LoopUpdate` 写 state/metrics（`continue`）；待办清空或只剩用户拍板项时 `status=completed`；只有明确取消或满足停止条件才 `LoopDelete`。
   - 一个任务一个 loop，别让多个 loop 抢同一件事。
2. 干完的活**当场提交并 push**，别攒着（本仓库 `.gitignore` 只备份源代码：`*.xlsx`、图片、含密钥的配置不入库）。
3. 需要用户/人事拍板的事（业务口径、法定节假日天数、是否加人）**不要自己猜**：停下来问，并在 loop 里标 `paused`。
