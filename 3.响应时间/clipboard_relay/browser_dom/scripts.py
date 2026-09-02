#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

_MODULE = "clipboard_relay.browser_dom"
_REPLY_INPUT_SELECTOR = "textarea, [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox'], input[type='text']"
_REPLY_INPUT_WAIT_TIMEOUT_SEC = 300.0
_REPLY_INPUT_POLL_INTERVAL_SEC = 0.1
_REPLY_INPUT_PROGRESS_LOG_SEC = 2.0
_REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS = 1000
_REPLY_INPUT_WRITE_CONFIRM_TIMEOUT_SEC = 60.0
_REPLY_INPUT_WRITE_POLL_INTERVAL_SEC = 0.05
_REPLY_INPUT_STABLE_MISMATCH_POLLS = 5
_REPLY_INPUT_EMPTY_MISMATCH_POLLS = 20
_REPLY_INPUT_STATE_SCRIPT = """selector => {
    const nodes = Array.from(document.querySelectorAll(selector));
    let best = null;
    let visibleCount = 0;
    let editableCount = 0;
    for (let index = 0; index < nodes.length; index += 1) {
        const el = nodes[index];
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const tag = (el.tagName || '').toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const label = [
            el.getAttribute('placeholder') || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
        ].join(' ');
        const visible = rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && style.opacity !== '0';
        const editable = tag === 'textarea'
            || (tag === 'input' && type === 'text')
            || el.isContentEditable
            || role === 'textbox';
        const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true';
        const readonly = Boolean(el.readOnly)
            || el.hasAttribute('readonly')
            || el.getAttribute('aria-readonly') === 'true';
        if (visible) visibleCount += 1;
        if (editable && !disabled && !readonly) editableCount += 1;
        if (!visible || !editable || disabled || readonly || rect.width < 80 || rect.height < 12) {
            continue;
        }
        if (/搜索|关键词|快捷短语|联系人/.test(label)) {
            continue;
        }
        let score = rect.y * 10 + rect.width * rect.height;
        if (rect.x < 0 || rect.y < 0) score -= 100000;
        const candidate = {
            index,
            tag,
            type,
            role,
            maxlength: 'maxLength' in el ? Number(el.maxLength || -1) : -1,
            placeholder: el.getAttribute('placeholder') || '',
            aria: el.getAttribute('aria-label') || '',
            title: el.getAttribute('title') || '',
            editable,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            score,
        };
        if (!best || candidate.score > best.score) {
            best = candidate;
        }
    }
    return {
        count: nodes.length,
        visible_count: visibleCount,
        editable_count: editableCount,
        best,
    };
}"""
_REPLY_INPUT_META_SCRIPT = """node => {
    const tag = (node.tagName || '').toLowerCase();
    const type = (node.getAttribute('type') || '').toLowerCase();
    const role = (node.getAttribute('role') || '').toLowerCase();
    const maxlength = 'maxLength' in node ? Number(node.maxLength || -1) : -1;
    const placeholder = node.getAttribute('placeholder') || '';
    const aria = node.getAttribute('aria-label') || '';
    const title = node.getAttribute('title') || '';
    return {
        tag,
        type,
        role,
        maxlength,
        placeholder,
        aria,
        title,
        editable: Boolean(node.isContentEditable || tag === 'textarea' || (tag === 'input' && type === 'text') || role === 'textbox'),
    };
}"""
_REPLY_INPUT_READY_SCRIPT = """node => {
    const tag = (node.tagName || '').toLowerCase();
    const type = (node.getAttribute('type') || '').toLowerCase();
    const role = (node.getAttribute('role') || '').toLowerCase();
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const connected = Boolean(node.isConnected);
    const visible = connected
        && rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && style.opacity !== '0';
    const editable = tag === 'textarea'
        || (tag === 'input' && type === 'text')
        || node.isContentEditable
        || role === 'textbox';
    const disabled = Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true';
    const readonly = Boolean(node.readOnly)
        || node.hasAttribute('readonly')
        || node.getAttribute('aria-readonly') === 'true';
    const inViewport = rect.bottom > 0
        && rect.right > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight;
    let reason = '已就绪';
    if (!connected) {
        reason = '输入框已从页面移除';
    } else if (!visible) {
        reason = '输入框不可见';
    } else if (!editable) {
        reason = '输入框不可编辑';
    } else if (disabled) {
        reason = '输入框被禁用';
    } else if (readonly) {
        reason = '输入框只读';
    } else if (!inViewport) {
        reason = '输入框不在可视区域';
    }
    return {
        connected,
        visible,
        editable,
        disabled,
        readonly,
        in_viewport: inViewport,
        ready: visible && editable && !disabled && !readonly && inViewport,
        reason,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    };
}"""
_REPLY_INPUT_ACTIVATE_SCRIPT = """node => {
    if (!node || !node.isConnected) {
        return false;
    }
    if (typeof node.scrollIntoView === 'function') {
        try {
            node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        } catch (error) {
            node.scrollIntoView();
        }
    }
    if (typeof node.focus === 'function') {
        try {
            node.focus({ preventScroll: true });
        } catch (error) {
            node.focus();
        }
    }
    if (typeof node.click === 'function') {
        try {
            node.click();
        } catch (error) {
            // 页面重绘时原生 click 可能失败；真正写入结果会在后续回读里验证。
        }
    }
    return true;
}"""
_REPLY_INPUT_SET_TEXT_SCRIPT = """(node, value) => {
    const text = String(value || '');
    const tag = (node.tagName || '').toLowerCase();
    const type = (node.getAttribute('type') || '').toLowerCase();
    if (typeof node.focus === 'function') {
        node.focus();
    }
    if ('value' in node) {
        const proto = Object.getPrototypeOf(node);
        const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
        if (descriptor && typeof descriptor.set === 'function') {
            descriptor.set.call(node, text);
        } else {
            node.value = text;
        }
    } else if (node.isContentEditable || node.getAttribute('contenteditable')) {
        node.innerHTML = '';
        const lines = text.split('\\n');
        lines.forEach((line, index) => {
            if (index > 0) {
                node.appendChild(document.createElement('br'));
            }
            node.appendChild(document.createTextNode(line));
        });
    } else {
        node.textContent = text;
    }
    for (const typeName of ['beforeinput', 'input', 'change']) {
        let event = null;
        if (typeName === 'beforeinput' || typeName === 'input') {
            try {
                event = new InputEvent(typeName, { bubbles: true, cancelable: true, data: text, inputType: 'insertText' });
            } catch (error) {
                event = new Event(typeName, { bubbles: true, cancelable: true });
            }
        } else {
            event = new Event(typeName, { bubbles: true, cancelable: true });
        }
        node.dispatchEvent(event);
    }
    return {
        tag,
        type,
        length: text.length,
    };
}"""
_REPLY_INPUT_PAGE_VALUE_SCRIPT = """selector => {
    const nodes = Array.from(document.querySelectorAll(selector));
    let best = null;
    let visibleCount = 0;
    let editableCount = 0;
    for (let index = 0; index < nodes.length; index += 1) {
        const el = nodes[index];
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const tag = (el.tagName || '').toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const label = [
            el.getAttribute('placeholder') || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
        ].join(' ');
        const visible = rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && style.opacity !== '0';
        const editable = tag === 'textarea'
            || (tag === 'input' && type === 'text')
            || el.isContentEditable
            || role === 'textbox';
        const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true';
        const readonly = Boolean(el.readOnly)
            || el.hasAttribute('readonly')
            || el.getAttribute('aria-readonly') === 'true';
        if (visible) visibleCount += 1;
        if (editable && !disabled && !readonly) editableCount += 1;
        if (!visible || !editable || disabled || readonly || rect.width < 80 || rect.height < 12) {
            continue;
        }
        if (/搜索|关键词|快捷短语|联系人/.test(label)) {
            continue;
        }
        let score = rect.y * 10 + rect.width * rect.height;
        if (rect.x < 0 || rect.y < 0) score -= 100000;
        if (!best || score > best.score) {
            best = { node: el, index, tag, type, role, score };
        }
    }
    if (!best) {
        return {
            ok: false,
            reason: '未找到可读输入框',
            count: nodes.length,
            visible_count: visibleCount,
            editable_count: editableCount,
            value: '',
        };
    }
    const node = best.node;
    const value = 'value' in node ? (node.value || '') : (node.innerText || node.textContent || '');
    return {
        ok: true,
        value,
        index: best.index,
        tag: best.tag,
        type: best.type,
        role: best.role,
        count: nodes.length,
        visible_count: visibleCount,
        editable_count: editableCount,
    };
}"""
_REPLY_INPUT_PAGE_SET_TEXT_SCRIPT = """payload => {
    const selector = String(payload.selector || '');
    const text = String(payload.value || '');
    const nodes = Array.from(document.querySelectorAll(selector));
    let best = null;
    let visibleCount = 0;
    let editableCount = 0;
    for (let index = 0; index < nodes.length; index += 1) {
        const el = nodes[index];
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const tag = (el.tagName || '').toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const label = [
            el.getAttribute('placeholder') || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
        ].join(' ');
        const visible = rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && style.opacity !== '0';
        const editable = tag === 'textarea'
            || (tag === 'input' && type === 'text')
            || el.isContentEditable
            || role === 'textbox';
        const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true';
        const readonly = Boolean(el.readOnly)
            || el.hasAttribute('readonly')
            || el.getAttribute('aria-readonly') === 'true';
        if (visible) visibleCount += 1;
        if (editable && !disabled && !readonly) editableCount += 1;
        if (!visible || !editable || disabled || readonly || rect.width < 80 || rect.height < 12) {
            continue;
        }
        if (/搜索|关键词|快捷短语|联系人/.test(label)) {
            continue;
        }
        let score = rect.y * 10 + rect.width * rect.height;
        if (rect.x < 0 || rect.y < 0) score -= 100000;
        if (!best || score > best.score) {
            best = { node: el, index, tag, type, role, score };
        }
    }
    if (!best) {
        return {
            ok: false,
            reason: '未找到可写输入框',
            count: nodes.length,
            visible_count: visibleCount,
            editable_count: editableCount,
            value: '',
        };
    }
    const node = best.node;
    if (typeof node.focus === 'function') {
        node.focus();
    }
    if ('value' in node) {
        const proto = Object.getPrototypeOf(node);
        const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
        if (descriptor && typeof descriptor.set === 'function') {
            descriptor.set.call(node, text);
        } else {
            node.value = text;
        }
    } else if (node.isContentEditable || node.getAttribute('contenteditable')) {
        node.innerHTML = '';
        const lines = text.split('\\n');
        lines.forEach((line, index) => {
            if (index > 0) {
                node.appendChild(document.createElement('br'));
            }
            node.appendChild(document.createTextNode(line));
        });
    } else {
        node.textContent = text;
    }
    for (const typeName of ['beforeinput', 'input', 'change']) {
        let event = null;
        if (typeName === 'beforeinput' || typeName === 'input') {
            try {
                event = new InputEvent(typeName, { bubbles: true, cancelable: true, data: text, inputType: 'insertText' });
            } catch (error) {
                event = new Event(typeName, { bubbles: true, cancelable: true });
            }
        } else {
            event = new Event(typeName, { bubbles: true, cancelable: true });
        }
        node.dispatchEvent(event);
    }
    const value = 'value' in node ? (node.value || '') : (node.innerText || node.textContent || '');
    return {
        ok: true,
        value,
        index: best.index,
        tag: best.tag,
        type: best.type,
        role: best.role,
        length: text.length,
    };
}"""

__all__ = [name for name in globals() if name.startswith("_REPLY_INPUT_") or name == "_MODULE"]
