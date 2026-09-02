#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from .browser_errors import _is_navigation_context_error
from .logger import log

_MODULE = "refund_reminder.erp_navigation"
ORDER_QUERY_KEYWORD = "订单查询"


def try_enter_order_query_page(page: Any) -> bool:
    # 该函数用于从 ERP 首页菜单搜索并进入订单查询页，点击后只等待状态不等待固定时间。
    try:
        menu_opened = _ensure_menu_open(page)
        search_activated = _activate_menu_search(page)
        search_filled = _fill_menu_search(page, ORDER_QUERY_KEYWORD)
        clicked = _click_text_by_point(page, ORDER_QUERY_KEYWORD, prefer_left_panel=True)
        log(
            "Browser",
            "进入订单查询页",
            _MODULE,
            "try_enter_order_query_page",
            menu_opened=menu_opened,
            search_activated=search_activated,
            search_filled=search_filled,
            clicked=clicked,
        )
        return bool(clicked or search_filled or search_activated or menu_opened)
    except Exception as exc:
        if _is_navigation_context_error(exc):
            log("Browser", "菜单点击触发页面跳转", _MODULE, "try_enter_order_query_page.navigation", reason=str(exc))
            return True
        raise RuntimeError(f"进入订单查询页失败：{exc}") from exc


def click_search(page: Any) -> bool:
    # 该函数用于点击 ERP 订单查询页的查询按钮，跨 frame 查找可见按钮。
    script = """() => {
      function visible(item) {
        const rect = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }
      function score(item) {
        const rect = item.getBoundingClientRect();
        const nearby = String((item.closest("form,.el-form,.ant-form,.x-panel,.datagrid-toolbar,.toolbar,.search,.filter,.query") || document.body).innerText || "");
        let value = 0;
        if (nearby.includes("默认筛选")) value += 100;
        if (nearby.includes("单据时间")) value += 80;
        if (nearby.includes("退款")) value += 50;
        if (nearby.includes("作废")) value += 50;
        if (rect.top < 120) value -= 80;
        if (rect.left < 260) value -= 40;
        value -= Math.abs(rect.width - 72);
        return value;
      }
      const candidates = Array.from(document.querySelectorAll("button,a,span,div"))
        .filter(visible)
        .filter((item) => {
        const text = (item.innerText || item.textContent || "").trim();
        const normalized = text.replace(/\\s+/g, "");
        return normalized === "查询";
      })
        .map((item) => ({ item, score: score(item), rect: item.getBoundingClientRect() }))
        .sort((a, b) => b.score - a.score);
      const target = candidates[0] && candidates[0].item;
      if (!target) return false;
      const clickable = target.closest("button,a") || target;
      clickable.click();
      return true;
    }"""
    for frame in _frames_or_page(page):
        try:
            if bool(frame.evaluate(script)):
                return True
        except Exception as exc:
            if _is_navigation_context_error(exc):
                return True
    return False


def ensure_custom_filter_panel(page: Any) -> dict[str, Any]:
    # 该函数用于确保订单查询页左侧“自定义”筛选区已展开，避免扫到默认筛选结果。
    script = """async () => {
      function visible(node) {
        if (!node || !node.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }
      function textOf(node) {
        return String((node && (node.innerText || node.textContent)) || "").replace(/\\s+/g, " ").trim();
      }
      function normalize(value) {
        return String(value || "").replace(/[\\s:：]+/g, "").trim();
      }
      function clickNode(node) {
        if (!node) return false;
        const target = node.closest && node.closest("button,a,[role='button'],.el-collapse-item__header,.x-panel-header,.ant-collapse-header,.filter-title,div") || node;
        target.scrollIntoView({ block: "center", inline: "center" });
        for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        if (typeof target.click === "function") target.click();
        return true;
      }
      function leftPanelVisible(node) {
        if (!visible(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.left >= -5 && rect.left < 260 && rect.top > 180;
      }
      function customFieldsVisible() {
        const fieldNames = ["自定义条件", "单据时间", "支付时间", "店铺名称", "平台单号", "物流单号"];
        return Array.from(document.querySelectorAll("label,span,div,input,select"))
          .filter(leftPanelVisible)
          .some((node) => fieldNames.some((name) => normalize(textOf(node)).includes(normalize(name)) || normalize(node.getAttribute && node.getAttribute("placeholder")).includes(normalize(name))));
      }
      function customHeaderCandidates() {
        return Array.from(document.querySelectorAll("button,a,span,div,[role='button']"))
          .filter(leftPanelVisible)
          .map((node) => ({ node, text: normalize(textOf(node)), rect: node.getBoundingClientRect() }))
          .filter((item) => item.text === "自定义")
          .sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left));
      }
      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
      if (customFieldsVisible()) {
        return { found: true, already_open: true, clicked: false, fields_visible: true, source: "custom-fields-visible" };
      }
      const candidates = customHeaderCandidates();
      if (!candidates.length) {
        return { found: false, already_open: false, clicked: false, fields_visible: false, source: "custom-header-not-found" };
      }
      const clicked = clickNode(candidates[0].node);
      const deadline = performance.now() + 1500;
      while (performance.now() <= deadline) {
        if (customFieldsVisible()) {
          return { found: true, already_open: false, clicked, fields_visible: true, source: "custom-header-clicked" };
        }
        await sleep(100);
      }
      return { found: true, already_open: false, clicked, fields_visible: customFieldsVisible(), source: "custom-fields-timeout" };
    }"""
    last_payload: dict[str, Any] = {"found": False, "already_open": False, "clicked": False, "fields_visible": False, "source": "no-frame"}
    for index, frame in enumerate(_frames_or_page(page)):
        try:
            payload = dict(frame.evaluate(script) or {})
        except Exception as exc:
            if _is_navigation_context_error(exc):
                return {"found": True, "already_open": False, "clicked": True, "fields_visible": False, "source": f"frame{index}:navigation"}
            last_payload = {"found": False, "already_open": False, "clicked": False, "fields_visible": False, "source": f"frame{index}:异常 {type(exc).__name__}:{str(exc)[:120]}"}
            continue
        payload["source"] = f"frame{index}:{payload.get('source') or 'unknown'}"
        if payload.get("fields_visible"):
            return payload
        if payload.get("found"):
            last_payload = payload
    return last_payload


def _frames_or_page(page: Any) -> list[Any]:
    # 该函数用于兼容少数场景下 page.frames 暂时为空，避免页面可用却跳过检测脚本。
    frames = list(getattr(page, "frames", []) or [])
    return frames if frames else [page]


def _ensure_menu_open(page: Any) -> bool:
    # 该函数用于确保左上菜单面板可见；菜单已打开时不重复点击。
    if _menu_search_input_visible(page):
        return False
    return _click_text_by_point(page, "菜单", prefer_left_panel=True)


def _menu_search_input_visible(page: Any) -> bool:
    # 该函数用于判断菜单搜索框是否已出现。
    try:
        return bool(
            page.evaluate(
                """() => Array.from(document.querySelectorAll("input")).some((item) => {
                  const rect = item.getBoundingClientRect();
                  const style = getComputedStyle(item);
                  return rect.width > 80 && rect.height > 16 && rect.left < 280 && rect.top < 90 && style.display !== "none" && style.visibility !== "hidden";
                })"""
            )
        )
    except Exception as exc:
        if _is_navigation_context_error(exc):
            return False
        raise


def _activate_menu_search(page: Any) -> bool:
    # 该函数用于点击左上角菜单搜索入口，ERP 搜索框只有激活后才接收输入。
    try:
        point = page.evaluate(
            """() => {
              function visible(node) {
                if (!node || !node.getBoundingClientRect) return false;
                const rect = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rect.width > 4 && rect.height > 4 && style.display !== "none" && style.visibility !== "hidden";
              }
              function score(node) {
                const rect = node.getBoundingClientRect();
                const raw = [
                  node.getAttribute("aria-label"),
                  node.getAttribute("title"),
                  node.getAttribute("placeholder"),
                  node.getAttribute("class"),
                  node.innerText,
                  node.textContent,
                ].join(" ").toLowerCase();
                let value = rect.left + rect.top;
                if (raw.includes("搜索") || raw.includes("search")) value -= 200;
                if (raw.includes("query") || raw.includes("magnifier")) value -= 60;
                if (rect.left < 40) value -= 30;
                return value;
              }
              const nodes = Array.from(document.querySelectorAll("input,button,a,span,div,i,svg"));
              const candidates = nodes
                .filter(visible)
                .map((node) => ({ node, rect: node.getBoundingClientRect(), score: score(node) }))
                .filter((entry) => entry.rect.left >= 0 && entry.rect.left < 90 && entry.rect.top >= 28 && entry.rect.top < 92)
                .filter((entry) => entry.rect.width <= 90 && entry.rect.height <= 48)
                .sort((a, b) => a.score - b.score);
              const target = candidates[0] && candidates[0].node;
              if (target) {
                const rect = target.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, source: "candidate" };
              }
              return { x: 18, y: 52, source: "fallback" };
            }"""
        )
        if not point:
            return False
        page.mouse.click(float(point["x"]), float(point["y"]))
        log("Browser", "点击菜单搜索入口", _MODULE, "_activate_menu_search", source=str(point.get("source")), x=point.get("x"), y=point.get("y"))
        return True
    except Exception as exc:
        if _is_navigation_context_error(exc):
            return True
        raise


def _fill_menu_search(page: Any, keyword: str) -> bool:
    # 该函数用于在左侧菜单搜索框输入订单查询，不依赖 locator 坐标等待，避免首页控件慢加载时超时。
    try:
        return bool(
            page.evaluate(
                """(keyword) => {
                  function visible(node) {
                    if (!node || !node.getBoundingClientRect) return false;
                    const rect = node.getBoundingClientRect();
                    const style = getComputedStyle(node);
                    return rect.width > 60 && rect.height > 14 && style.display !== "none" && style.visibility !== "hidden";
                  }
                  function score(item) {
                    const placeholder = String(item.getAttribute("placeholder") || "");
                    const rect = item.getBoundingClientRect();
                    let value = 0;
                    if (placeholder.includes("搜索")) value -= 100;
                    if (placeholder.includes("菜单")) value -= 80;
                    if (rect.left < 280) value -= 50;
                    if (rect.top < 120) value -= 40;
                    if (document.activeElement === item) value -= 120;
                    value += rect.left + rect.top;
                    return value;
                  }
                  const candidates = Array.from(document.querySelectorAll("input"))
                    .filter(visible)
                    .map((item) => ({ item, rect: item.getBoundingClientRect(), score: score(item) }))
                    .filter((entry) => entry.rect.left < 340 && entry.rect.top < 150)
                    .sort((a, b) => a.score - b.score);
                  const target = candidates[0] && candidates[0].item;
                  if (!target) return false;
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                  target.focus();
                  target.click();
                  setter.call(target, "");
                  target.dispatchEvent(new Event("input", { bubbles: true }));
                  setter.call(target, keyword);
                  target.dispatchEvent(new Event("input", { bubbles: true }));
                  target.dispatchEvent(new Event("change", { bubbles: true }));
                  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: keyword[0] || "" }));
                  target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: keyword[keyword.length - 1] || "" }));
                  return true;
                }""",
                keyword,
            )
        )
    except Exception as exc:
        if _is_navigation_context_error(exc):
            return True
        raise


def _click_text_by_point(page: Any, text: str, *, prefer_left_panel: bool) -> bool:
    # 该函数先取可见文字坐标再鼠标点击，避免在 evaluate 内点击导致上下文销毁。
    point = _find_text_point(page, text, prefer_left_panel=prefer_left_panel)
    if not point:
        return False
    page.mouse.click(float(point["x"]), float(point["y"]))
    return True


def _find_text_point(page: Any, text: str, *, prefer_left_panel: bool) -> dict[str, float] | None:
    # 该函数用于寻找可点击文本中心点，左侧菜单优先，避免点到顶部标签页。
    return page.evaluate(
        """({ text, preferLeftPanel }) => {
          function visible(node) {
            if (!node || !node.getBoundingClientRect) return false;
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          }
          const nodes = Array.from(document.querySelectorAll("a,button,span,div,li"));
          const matches = nodes
            .filter(visible)
            .map((node) => ({ node, rect: node.getBoundingClientRect(), value: String(node.innerText || node.textContent || "").trim() }))
            .filter((item) => item.value === text);
          if (matches.length <= 0) return null;
          const sorted = matches.sort((a, b) => {
            const aLeft = a.rect.left < 300 ? 0 : 1;
            const bLeft = b.rect.left < 300 ? 0 : 1;
            if (preferLeftPanel && aLeft !== bLeft) return aLeft - bLeft;
            return (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left);
          });
          const rect = sorted[0].rect;
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }""",
        {"text": text, "preferLeftPanel": prefer_left_panel},
    )


__all__ = ["ORDER_QUERY_KEYWORD", "click_search", "ensure_custom_filter_panel", "try_enter_order_query_page"]
