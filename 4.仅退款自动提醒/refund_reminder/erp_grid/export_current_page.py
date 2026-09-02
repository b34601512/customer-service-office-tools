# 该文件用于在 ERP 当前退款筛选页自动刷新、全选并导出当前页订单表。
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from ..browser_errors import _is_navigation_context_error
from ..config import AppConfig
from ..logger import log
from .constants import MODULE_NAME


def export_current_order_page(page: Any, config: AppConfig, output_path: Path, status: Callable[[str], None] | None = None) -> Path:
    # 该函数用于通过 Playwright 下载通道保存订单查询表，避免系统“是否覆盖”弹窗。
    output_path = Path(output_path)
    temp_path = output_path.with_name(f"{output_path.stem}.download.tmp{output_path.suffix}")
    _assert_output_file_writable(output_path)
    _emit(status, "准备全选当前页订单。")
    select_payload = select_all_current_page_orders(page)
    log("Browser", "全选当前页订单", MODULE_NAME, "export_current_order_page.select_all", **select_payload)
    _emit(status, f"全选当前页订单：{'成功' if select_payload.get('clicked') else '未找到全选控件'}，来源 {select_payload.get('source') or '未知'}。")
    if not select_payload.get("clicked"):
        raise RuntimeError(f"导出当前页失败：未找到订单表头全选控件，证据={select_payload}")
    _emit(status, f"准备导出当前页订单并覆盖文件：{output_path.name}。")
    with page.expect_download(timeout=int(max(10.0, float(config.login.page_load_timeout_sec)) * 1000)) as download_info:
        export_payload = click_export_current_page(page)
        log("Browser", "点击导出当前页", MODULE_NAME, "export_current_order_page.click_export", **export_payload)
        if not export_payload.get("clicked"):
            raise RuntimeError(f"导出当前页失败：未找到「导出当前页」按钮，证据={export_payload}")
    download = download_info.value
    temp_path.parent.mkdir(parents=True, exist_ok=True)
    if temp_path.exists():
        temp_path.unlink()
    download.save_as(str(temp_path))
    _replace_export_file(temp_path, output_path)
    _emit(status, f"当前页订单已导出：{output_path}")
    return output_path


def select_all_current_page_orders(page: Any) -> dict[str, Any]:
    # 该函数用于点击订单表头部全选框，保持导出前状态明确。
    script = """() => {
      function visible(node) {
        if (!node || !node.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }
      function clickNode(node) {
        if (!node) return false;
        node.scrollIntoView({ block: "center", inline: "center" });
        for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
          node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        if (typeof node.click === "function") node.click();
        return true;
      }
      const nodes = Array.from(document.querySelectorAll(
        ".ag-header input[type='checkbox'],.ag-header [role='checkbox'],.ag-header .ag-checkbox-input,.ag-header .ag-checkbox,"
        + ".datagrid-header input[type='checkbox'],.datagrid-header .datagrid-cell-check,input[type='checkbox']"
      )).filter(visible).map((node) => ({ node, rect: node.getBoundingClientRect(), text: String(node.innerText || node.textContent || "") }))
        .filter((item) => item.rect.left > 220 && item.rect.top > 190)
        .sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left));
      const target = nodes[0] && nodes[0].node;
      return { clicked: clickNode(target), source: target ? "header-checkbox" : "not-found", candidate_count: nodes.length };
    }"""
    return _evaluate_in_frames(page, script, success_key="clicked")


def click_export_current_page(page: Any) -> dict[str, Any]:
    # 该函数用于点击 ERP 底部“导出当前页”，只做导出动作不再读取操作日志。
    script = """() => {
      function visible(node) {
        if (!node || !node.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }
      function textOf(node) {
        return String((node && (node.innerText || node.textContent || node.getAttribute("title") || "")) || "").replace(/\\s+/g, " ").trim();
      }
      function clickNode(node) {
        if (!node) return false;
        const target = node.closest && node.closest("button,a,[role='button'],span,div") || node;
        target.scrollIntoView({ block: "center", inline: "center" });
        for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        if (typeof target.click === "function") target.click();
        return true;
      }
      const nodes = Array.from(document.querySelectorAll("button,a,span,div"))
        .filter(visible)
        .map((node) => ({ node, text: textOf(node), rect: node.getBoundingClientRect() }))
        .filter((item) => item.text.replace(/\\s+/g, "").includes("导出当前页"))
        .sort((a, b) => (b.rect.top - a.rect.top) || (b.rect.left - a.rect.left));
      const target = nodes[0] && nodes[0].node;
      return { clicked: clickNode(target), source: target ? "export-current-page" : "not-found", candidate_count: nodes.length };
    }"""
    return _evaluate_in_frames(page, script, success_key="clicked")


def _evaluate_in_frames(page: Any, script: str, *, success_key: str) -> dict[str, Any]:
    # 该函数跨 frame 执行动作，哪个 frame 成功就返回哪个，避免 ERP 主体嵌在 iframe 里。
    frames = list(getattr(page, "frames", []) or []) or [page]
    last_payload: dict[str, Any] = {"clicked": False, "source": "no-frame", "candidate_count": 0}
    for index, frame in enumerate(frames):
        try:
            payload = dict(frame.evaluate(script) or {})
        except Exception as exc:
            if _is_navigation_context_error(exc):
                return {"clicked": True, "source": f"frame{index}:navigation", "candidate_count": 0}
            last_payload = {"clicked": False, "source": f"frame{index}:异常 {type(exc).__name__}:{str(exc)[:120]}", "candidate_count": 0}
            continue
        payload["source"] = f"frame{index}:{payload.get('source') or 'unknown'}"
        if payload.get(success_key):
            return payload
        if payload.get("candidate_count"):
            last_payload = payload
    return last_payload


def _assert_output_file_writable(path: Path) -> None:
    # 该函数在导出前确认目标文件没有被 Excel/WPS 占用，否则覆盖会失败。
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        return
    try:
        with path.open("a+b"):
            pass
    except PermissionError as exc:
        raise RuntimeError(f"导出订单失败：{path.name} 正在被 Excel/WPS 或其他程序占用，请先关闭该文件后再启动监控。") from exc


def _replace_export_file(temp_path: Path, output_path: Path) -> None:
    # 该函数只保留固定文件名，避免每轮下载堆出无限文件。
    try:
        temp_path.replace(output_path)
    except PermissionError as exc:
        raise RuntimeError(f"导出订单失败：无法覆盖 {output_path.name}，请确认该文件没有打开。") from exc


def _emit(status: Callable[[str], None] | None, message: str) -> None:
    # 该函数统一把导出动作反馈到后台实时日志。
    if status:
        status(message)


__all__ = ["click_export_current_page", "export_current_order_page", "select_all_current_page_orders"]
