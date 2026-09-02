# 该文件用于读取 ERP 页面状态、标题、URL 和诊断文本。
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from ..browser_errors import _is_navigation_context_error
from ..config import AppConfig
from ..logger import log
from .constants import MODULE_NAME
from .diagnosis import diagnose_order_page_text
from .types import BrowserPageState, OrderPageDiagnosis


class PageStateMixin:
    def _diagnose_order_page(self, page: Any, config: AppConfig) -> OrderPageDiagnosis:
        # 该函数用于读取页面文本并产出订单页识别诊断信息。
        try:
            page_text, frame_count, frame_summaries = self._read_all_frame_text(page)
            return diagnose_order_page_text(page_text, config.detection.required_page_texts, frame_count=frame_count, frame_summaries=frame_summaries)
        except Exception as exc:
            if _is_navigation_context_error(exc):
                return diagnose_order_page_text("", config.detection.required_page_texts)
            raise RuntimeError(f"读取订单页诊断失败：{exc}") from exc

    @staticmethod
    def _diagnosis_key(diagnosis: OrderPageDiagnosis) -> str:
        # 该函数用于判断诊断状态是否变化，避免每次轮询刷同样日志。
        return "|".join(
            [
                str(diagnosis.ready),
                str(diagnosis.has_order_keyword),
                str(diagnosis.matched_count),
                ",".join(diagnosis.matched_landmarks),
                str(diagnosis.required_texts_matched),
                str(diagnosis.login_wait_page),
                str(diagnosis.frame_count),
            ]
        )

    @staticmethod
    def _format_order_page_diagnosis(diagnosis: OrderPageDiagnosis) -> str:
        # 该函数用于把订单页识别诊断转成中文日志。
        matched = "、".join(diagnosis.matched_landmarks) or "无"
        missing = "、".join(diagnosis.missing_landmarks[:6]) or "无"
        return (
            f"订单页识别状态：订单查询关键字={'有' if diagnosis.has_order_keyword else '无'}，"
            f"命中 {diagnosis.matched_count}/3 个必要特征「{matched}」，"
            f"缺少「{missing}」，配置文字兜底={'通过' if diagnosis.required_texts_matched else '未通过'}，"
            f"登录等待页={'是' if diagnosis.login_wait_page else '否'}，"
            f"检测 frame 数={diagnosis.frame_count}，页面片段「{diagnosis.text_sample or '空'}」。"
            f"{' frame摘要「' + ' || '.join(diagnosis.frame_summaries[:4]) + '」' if diagnosis.frame_summaries else ''}"
        )

    def _read_all_frame_text(self, page: Any) -> tuple[str, int, tuple[str, ...]]:
        # 该函数用于跨 frame 读取 ERP 文本，避免只读到外层壳页面。
        frames = list(getattr(page, "frames", []) or [])
        texts: list[str] = []
        summaries: list[str] = []
        for index, frame in enumerate(frames):
            try:
                text = str(frame.evaluate("""() => String((document.body && document.body.innerText) || "")""") or "")
            except Exception as exc:
                if not _is_navigation_context_error(exc):
                    summaries.append(f"frame{index}:读取失败 {type(exc).__name__}:{str(exc)[:80]}")
                continue
            compact = " ".join(text.split())
            if not compact:
                summaries.append(f"frame{index}:空文本")
                continue
            diagnosis = diagnose_order_page_text(text)
            frame_url = str(getattr(frame, "url", "") or "")[:90]
            summaries.append(
                f"frame{index}:订单查询={'有' if diagnosis.has_order_keyword else '无'},"
                f"命中{diagnosis.matched_count},url={frame_url},片段={compact[:120]}"
            )
            texts.append(text)
        if texts:
            return "\n".join(texts), len(frames), tuple(summaries[:8])
        try:
            fallback_text = str(page.evaluate("""() => String((document.body && document.body.innerText) || "")""") or "")
            return fallback_text, max(1, len(frames)), tuple(summaries[:8])
        except Exception as exc:
            if _is_navigation_context_error(exc):
                return "", max(1, len(frames)), tuple(summaries[:8])
            raise RuntimeError(f"读取页面正文失败：{exc}") from exc

    def _page_state(self, page: Any, user_data_dir: Path | None) -> BrowserPageState:
        # 该函数用于生成当前 ERP 页面快照。
        return BrowserPageState(title=self._safe_page_title(page), url=self._safe_page_url(page), user_data_dir=Path(user_data_dir or ""))

    @staticmethod
    def _safe_page_title(page: Any) -> str:
        # 该函数把页面跳转中读取标题失败转成可继续轮询的状态，避免登录重定向被误判成失败。
        try:
            return str(page.title() or "")
        except Exception as exc:
            if _is_navigation_context_error(exc):
                return "页面跳转中"
            raise RuntimeError(f"读取页面标题失败：{exc}") from exc

    @staticmethod
    def _safe_page_url(page: Any) -> str:
        # 该函数统一读取当前 URL，只有真正异常才抛出中文原因。
        try:
            return str(getattr(page, "url", "") or "")
        except Exception as exc:
            if _is_navigation_context_error(exc):
                return ""
            raise RuntimeError(f"读取页面地址失败：{exc}") from exc

    def _require_page(self, page: Any, user_data_dir: Path | None) -> None:
        # 该函数用于阻止未打开 ERP 时继续执行页面动作。
        if page is None or user_data_dir is None:
            raise RuntimeError("ERP 浏览器尚未打开，请先在后台点击「打开ERP」")
        if page.is_closed():
            raise RuntimeError("ERP 页面已关闭，请重新打开 ERP")

    def _emit(self, status: Callable[[str], None] | None, message: str) -> None:
        # 该函数统一记录并转发浏览器状态。
        log("Browser", "状态", MODULE_NAME, "_emit", message=message)
        if status is not None:
            status(message)


__all__ = ["PageStateMixin"]
