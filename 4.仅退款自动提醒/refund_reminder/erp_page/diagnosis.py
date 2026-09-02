# 该文件用于识别和解释 ERP 是否已进入订单查询页。
from __future__ import annotations

from .constants import LOGIN_WAIT_PAGE_MARKERS, ORDER_PAGE_LANDMARKS, ORDER_QUERY_KEYWORD, PUBLIC_SITE_MARKERS
from .types import OrderPageDiagnosis


def diagnose_order_page_text(page_text: str, required_texts: tuple[str, ...] | list[str] = (), *, frame_count: int = 1, frame_summaries: tuple[str, ...] = ()) -> OrderPageDiagnosis:
    # 该函数用于解释为什么当前页面被判定为订单查询页或未通过判断。
    text = str(page_text or "")
    matched = tuple(item for item in ORDER_PAGE_LANDMARKS if item in text)
    missing = tuple(item for item in ORDER_PAGE_LANDMARKS if item not in text)
    has_order_keyword = ORDER_QUERY_KEYWORD in text
    required = tuple(str(item or "").strip() for item in required_texts if str(item or "").strip())
    required_matched = bool(required and all(item in text for item in required))
    ready = (has_order_keyword and len(matched) >= 3) or required_matched
    sample = " ".join(text.split())[:240]
    return OrderPageDiagnosis(
        ready=ready,
        matched_count=len(matched),
        matched_landmarks=matched,
        missing_landmarks=missing,
        has_order_keyword=has_order_keyword,
        required_texts_matched=required_matched,
        text_sample=sample,
        login_wait_page=_is_login_wait_page_text(text),
        frame_count=max(1, int(frame_count)),
        frame_summaries=tuple(frame_summaries),
    )


def _has_order_page_landmarks(page_text: str) -> bool:
    # 该函数用于判断是否已经在订单查询页，避免页面已就绪时反复打开菜单搜索。
    return diagnose_order_page_text(page_text).ready


def _is_login_wait_page_text(page_text: str) -> bool:
    # 该函数用于识别管易云登录/官网页，命中后只能等待用户登录，不能自动点菜单。
    text = str(page_text or "")
    login_marker_count = sum(1 for item in LOGIN_WAIT_PAGE_MARKERS if item in text)
    public_marker_count = sum(1 for item in PUBLIC_SITE_MARKERS if item in text)
    if login_marker_count >= 2:
        return True
    return public_marker_count >= 3 and "登录" in text and "申请试用" in text


__all__ = ["_has_order_page_landmarks", "_is_login_wait_page_text", "diagnose_order_page_text"]
