# 使用教程配图挂载（2026-10-05）

- 来源：黎路遥给的图库 `D:\Pictures\使用教程\`（17 张 PNG）
- 机制：`phrase.update` 的 `document_raw`（v3 文档，`__softtalk_rich_v3__:{...}`）+ `files:[{file_id,path}]` 摄入
  （**注意**：files 必须和 document_raw 一起传，只传 files 会 INVALID_REQUEST；文件身份由服务端映射，回执里有 file_id_map）
- 结果：**17/17 COMMITTED**，回读 `assets[].availability=cached`（`挂图核对.json`）
  - 家用 7：1A·A1·1LW·1SW·2AW·C1·Q1/Q2
  - 医用 7：Q3L·Q5L(-Q5S-Q5W)·Q10L·Y300W·Y5AW·Y5L·Y5W
  - 便携 3：Y105/Y106·YS-8Y·MY-5C
- 另有 2 条原本已有图（A1L←A1操作.png、C1L←c1操作.png），未动
- 仍缺图的 10 条（正文提到图示但无附件）：旧版Y105、P05B、MY-5C电池安装、MY-5C充电、遥控器电池安装图示、2AW美规、2SW美版、逆变器接电瓶图示、操作简单吗、紫外线杀菌灯不亮
- 日志：`挂图日志.json`（逐条 outcome）、`挂图核对.json`（终检）、`使用教程话术表.json`（33 条候选映射表）
