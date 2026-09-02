# 该文件用于输出订单扫描判定摘要和诊断日志。
from __future__ import annotations

from ..order_detector import DetectionResult


class DetectionSummaryMixin:
    def _append_detection_summary(self, detection: DetectionResult) -> None:
        # 该函数用于输出订单判定摘要，避免旧逐行日志把真正问题淹没。
        signature = self._detection_summary_signature(detection)
        if signature == self._last_detection_summary_signature:
            return
        self._last_detection_summary_signature = signature
        payment_time_count = sum(1 for item in detection.row_debugs if item.payment_time_found)
        refund_evidence_count = sum(1 for item in detection.row_debugs if item.refund_evidence_found)
        self._append_log(
            f"订单判定规则：来源「{detection.source}」，表头 {len(detection.headers)} 列，"
            "命中条件=导出退款订单表里有退款证据且平台单号合法；通知付款范围由运行配置控制。"
        )
        self._append_log(
            f"订单判定结果：读取 {detection.total_rows} 行，退款证据 {refund_evidence_count} 行，购买时间非空 {payment_time_count} 行，采集 {len(detection.problem_orders)} 个退款候选。"
        )
        if not detection.problem_orders and detection.total_rows > 0:
            for item in detection.row_debugs[:3]:
                nearby = "；".join(item.nearby_cells) or "无"
                self._append_log(
                    f"订单判定抽样：第{item.row_index + 1}行，原始{item.raw_cell_count}列/对齐{item.aligned_cell_count}列，"
                    f"{item.alignment_note}，支付日期「{item.payment_time_text or '空'}」，退款证据「{item.refund_evidence_text or '空'}」，"
                    f"原因「{item.reason}」，附近列「{nearby}」。"
                )
        if detection.problem_orders:
            preview = "、".join(self._short_log_text(item.summary, 80) for item in detection.problem_orders[:8])
            extra = f"，另有 {len(detection.problem_orders) - 8} 个未展开" if len(detection.problem_orders) > 8 else ""
            self._append_log(f"未处理候选订单摘要：{preview}{extra}。")

    @staticmethod
    def _detection_summary_signature(detection: DetectionResult) -> str:
        # 该函数用于识别扫描明细是否变化，控制后台日志噪声。
        rows = tuple(
            (
                item.row_index,
                item.payment_time_text,
                item.refund_evidence_text,
                item.payment_time_found,
                item.refund_evidence_found,
                item.is_problem,
                item.raw_cell_count,
                item.aligned_cell_count,
                item.alignment_note,
                item.nearby_cells,
            )
            for item in detection.row_debugs
        )
        return repr((detection.source, detection.headers, rows))

    @staticmethod
    def _short_log_text(value: str, limit: int) -> str:
        # 该函数用于裁剪单行诊断文本，避免一个单元格把后台日志撑爆。
        text = str(value or "")
        if len(text) <= limit:
            return text
        return text[:limit] + "..."


__all__ = ["DetectionSummaryMixin"]
