#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from ..logger import log
from .scripts import _MODULE

def ensure_first_consulting_customer_selected(page: Any) -> bool:
    # 该函数用于咚咚客服端发送前选中“正在咨询”里的第一个客户，避免没有会话焦点时回复失败。
    result = page.evaluate(
        """() => {
            const visible = (el) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
            };
            const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
            const all = Array.from(document.querySelectorAll('body *')).filter(visible);
            const headers = all
                .filter((el) => /正在咨询\\s*\\(\\s*\\d+\\s*\\)/.test(textOf(el)) || textOf(el) === '正在咨询')
                .map((el) => ({ el, rect: el.getBoundingClientRect(), text: textOf(el) }))
                .filter((item) => item.rect.left < 520)
                .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
            for (const header of headers) {
                const headerText = header.text;
                const countMatch = headerText.match(/正在咨询\\s*\\(\\s*(\\d+)\\s*\\)/);
                if (countMatch && Number(countMatch[1]) <= 0) {
                    return { clicked: false, reason: '正在咨询数量为0', header: headerText };
                }
                const maxRight = Math.max(header.rect.right + 360, 360);
                const rows = all
                    .map((el) => ({ el, rect: el.getBoundingClientRect(), text: textOf(el) }))
                    .filter((item) => {
                        const rect = item.rect;
                        const text = item.text;
                        if (!text || rect.top <= header.rect.bottom - 4) return false;
                        if (rect.left < header.rect.left - 30 || rect.left > maxRight) return false;
                        if (rect.width < 160 || rect.height < 36 || rect.height > 130) return false;
                        if (/正在咨询|留言|内部会话群|排序|搜索联系人|聊天/.test(text)) return false;
                        return true;
                    })
                    .sort((a, b) => a.rect.top - b.rect.top || b.rect.width - a.rect.width);
                if (rows.length > 0) {
                    rows[0].el.click();
                    return { clicked: true, text: rows[0].text, x: rows[0].rect.left, y: rows[0].rect.top };
                }
            }
            return { clicked: false, reason: '未找到正在咨询列表' };
        }"""
    )
    if bool(result.get("clicked")):
        log("Browser", "选中正在咨询客户", _MODULE, "ensure_first_consulting_customer_selected", text=str(result.get("text") or ""))
        return True
    log("Browser", "未选中正在咨询客户", _MODULE, "ensure_first_consulting_customer_selected", reason=str(result.get("reason") or "未知"))
    return False

__all__ = ["ensure_first_consulting_customer_selected"]
