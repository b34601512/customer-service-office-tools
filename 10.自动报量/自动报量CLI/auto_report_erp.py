from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from time import monotonic
from typing import Any, Callable, Iterable
from zipfile import ZipFile

from auto_report_credentials import (
    ERP_LOGIN_MODE_TENANT,
    ErpCredentials,
)


ERP_HOME_URL = "https://v2.guanyierp.com/index"
ERP_REPORT_NAME = "订单商品明细统计"
ERP_TASK_NAME = "订单商品明细统计报表导出"
ERP_TASK_CENTER_URL = "/task/task_center"
ERP_TASK_WAIT_SECONDS = 600


class ErpAutomationError(RuntimeError):
    """表示ERP自动下载无法安全继续。"""


class ErpBrowserClosedError(ErpAutomationError):
    """表示用户在自动流程完成前主动关闭了ERP浏览器。"""


@dataclass(frozen=True)
class ErpExportDateRange:
    """ERP订单商品明细统计使用的制单时间范围。"""

    start_datetime: datetime
    end_datetime: datetime

    def start_text(self) -> str:
        """返回ERP输入框使用的开始时间。"""
        return self.start_datetime.strftime("%Y-%m-%d %H:%M:%S")

    def end_text(self) -> str:
        """返回ERP输入框使用的结束时间。"""
        return self.end_datetime.strftime("%Y-%m-%d %H:%M:%S")


def build_erp_export_date_range(reference_date: date | None = None) -> ErpExportDateRange:
    """生成当月1日零点至明日零点的ERP制单时间范围。"""
    target_date = reference_date or date.today()
    month_start_date = target_date.replace(day=1)
    tomorrow_date = target_date + timedelta(days=1)
    return ErpExportDateRange(
        start_datetime=datetime.combine(month_start_date, time.min),
        end_datetime=datetime.combine(tomorrow_date, time.min),
    )


def locate_installed_chromium_browser() -> Path:
    """查找本机可用于ERP自动化的Edge或Chrome。"""
    browser_candidate_paths = (
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    )
    for browser_candidate_path in browser_candidate_paths:
        if browser_candidate_path.exists():
            return browser_candidate_path
    raise ErpAutomationError("未找到Microsoft Edge或Google Chrome。")


def build_erp_browser_launch_options(
    browser_profile_directory: Path,
    browser_executable_path: Path,
    download_directory: Path,
) -> dict[str, Any]:
    """生成跟随最大化窗口尺寸的ERP浏览器启动参数。"""
    return {
        "user_data_dir": str(browser_profile_directory),
        "executable_path": str(browser_executable_path),
        "headless": False,
        "accept_downloads": True,
        "downloads_path": str(download_directory),
        "no_viewport": True,
        "args": ["--start-maximized"],
    }


def maximize_erp_browser_window(browser_context: Any, page: Any) -> None:
    """通过浏览器窗口接口强制最大化当前ERP页面。"""
    page.wait_for_timeout(300)
    browser_control_session = browser_context.new_cdp_session(page)
    try:
        browser_window_information = browser_control_session.send(
            "Browser.getWindowForTarget"
        )
        browser_control_session.send(
            "Browser.setWindowBounds",
            {
                "windowId": browser_window_information["windowId"],
                "bounds": {"windowState": "maximized"},
            },
        )
    except Exception as error:
        raise ErpAutomationError("无法最大化ERP浏览器窗口。") from error
    finally:
        browser_control_session.detach()


def select_single_erp_work_page(browser_context: Any) -> Any:
    """关闭独立ERP配置恢复的旧标签页，只保留一个新工作页。"""
    existing_browser_pages = list(browser_context.pages)
    selected_work_page = next(
        (
            browser_page
            for browser_page in existing_browser_pages
            if not browser_page.is_closed() and browser_page.url == "about:blank"
        ),
        None,
    )
    if selected_work_page is None:
        selected_work_page = browser_context.new_page()
    for existing_browser_page in existing_browser_pages:
        if existing_browser_page == selected_work_page:
            continue
        if not existing_browser_page.is_closed():
            existing_browser_page.close()
    return selected_work_page


def _iter_page_scopes(page: Any) -> Iterable[Any]:
    """遍历ERP主页面和所有子页面区域。"""
    yield page
    for frame in page.frames:
        if frame != page.main_frame:
            yield frame


def _find_first_visible_locator(page: Any, selector_candidates: Iterable[str]) -> Any | None:
    """按候选选择器查找第一个可见控件。"""
    for page_scope in _iter_page_scopes(page):
        for selector_candidate in selector_candidates:
            candidate_locator = page_scope.locator(selector_candidate)
            candidate_count = min(candidate_locator.count(), 30)
            for candidate_index in range(candidate_count):
                visible_candidate_locator = candidate_locator.nth(candidate_index)
                if visible_candidate_locator.is_visible():
                    return visible_candidate_locator
    return None


def _find_first_visible_text_locator_in_scope(
    page_scope: Any,
    visible_text: str,
    exact: bool = True,
) -> Any | None:
    """在一个确定页面区域中查找第一个可见文字控件。"""
    candidate_locator = page_scope.get_by_text(visible_text, exact=exact)
    candidate_count = min(candidate_locator.count(), 50)
    for candidate_index in range(candidate_count):
        visible_candidate_locator = candidate_locator.nth(candidate_index)
        if visible_candidate_locator.is_visible():
            return visible_candidate_locator
    return None


def _find_first_visible_text_locator(page: Any, visible_text: str, exact: bool = True) -> Any | None:
    """在ERP主页面和子页面中查找第一个可见文字控件。"""
    for page_scope in _iter_page_scopes(page):
        visible_locator = _find_first_visible_text_locator_in_scope(
            page_scope,
            visible_text,
            exact,
        )
        if visible_locator is not None:
            return visible_locator
    return None


def _exception_indicates_browser_closed(error: Exception) -> bool:
    """判断浏览器操作异常是否由页面或浏览器关闭引起。"""
    normalized_error_text = str(error).lower()
    return any(
        closed_error_text in normalized_error_text
        for closed_error_text in (
            "target page, context or browser has been closed",
            "browser has been closed",
            "page has been closed",
            "target closed",
        )
    )


def _ensure_erp_browser_is_open(page: Any) -> None:
    """发现ERP页面已关闭时立即中止当前自动流程。"""
    try:
        page_is_closed = page.is_closed()
    except Exception as error:
        raise ErpBrowserClosedError("ERP浏览器已关闭，本次自动报量已取消。") from error
    if page_is_closed:
        raise ErpBrowserClosedError("ERP浏览器已关闭，本次自动报量已取消。")


def _wait_for_condition(
    page: Any,
    condition: Callable[[], bool],
    timeout_seconds: int,
    interval_seconds: float = 1.0,
) -> bool:
    """等待页面状态；浏览器关闭时立即取消，不再卡到超时。"""
    deadline = monotonic() + timeout_seconds
    while monotonic() < deadline:
        _ensure_erp_browser_is_open(page)
        try:
            if condition():
                return True
        except Exception as error:
            if _exception_indicates_browser_closed(error):
                raise ErpBrowserClosedError(
                    "ERP浏览器已关闭，本次自动报量已取消。"
                ) from error
            raise
        try:
            page.wait_for_timeout(max(1, round(interval_seconds * 1_000)))
        except Exception as error:
            if _exception_indicates_browser_closed(error):
                raise ErpBrowserClosedError(
                    "ERP浏览器已关闭，本次自动报量已取消。"
                ) from error
            raise
    return False


def _page_is_login_page(page: Any) -> bool:
    """判断当前是否停留在管易登录页。"""
    current_url = page.url.lower()
    if "login.guanyierp.com" in current_url:
        return True
    login_input = _find_first_visible_locator(
        page,
        (
            "#accountUser",
            "#tenantsUser",
            "input[placeholder='手机/邮箱/云之家']",
            "input[placeholder='请输入租户']",
        ),
    )
    return login_input is not None


def _fill_erp_login_form(page: Any, credentials: ErpCredentials) -> None:
    """把安全配置中的ERP账号密码填入登录页。"""
    if credentials.login_mode == ERP_LOGIN_MODE_TENANT:
        tenant_login_tab = _find_first_visible_text_locator(page, "租户登录")
        if tenant_login_tab is not None:
            tenant_login_tab.click()
        tenant_input = _find_first_visible_locator(
            page,
            ("#tenantsUser", "input[placeholder='请输入租户']"),
        )
        account_input = _find_first_visible_locator(
            page,
            ("#tenantsAccount", "input[placeholder='请输入账号']"),
        )
        password_input = _find_first_visible_locator(
            page,
            ("#tenantsPassword", "input[placeholder='请输入密码']", "input[type='password']"),
        )
        if tenant_input is None or account_input is None or password_input is None:
            raise ErpAutomationError("无法识别ERP租户登录输入框，页面可能已更新。")
        tenant_input.fill(credentials.tenant_code)
        account_input.fill(credentials.account_name)
        password_input.fill(credentials.password)
        return

    account_login_tab = _find_first_visible_text_locator(page, "账户登录")
    if account_login_tab is not None:
        account_login_tab.click()
    account_input = _find_first_visible_locator(
        page,
        ("#accountUser", "input[placeholder='手机/邮箱/云之家']"),
    )
    password_input = _find_first_visible_locator(
        page,
        ("#accountPassword", "input[placeholder='请输入密码']", "input[type='password']"),
    )
    if account_input is None or password_input is None:
        raise ErpAutomationError("无法识别ERP账户登录输入框，页面可能已更新。")
    account_input.fill(credentials.account_name)
    password_input.fill(credentials.password)


def _submit_erp_login(page: Any) -> None:
    """提交已填写的ERP登录表单。"""
    login_button = _find_first_visible_locator(
        page,
        (
            "button:has-text('登录')",
            "button:has-text('登 录')",
            "button[type='submit']",
            ".login-button",
            ".ant-btn-primary.ant-btn-block",
        ),
    )
    if login_button is None:
        raise ErpAutomationError("无法识别ERP登录按钮，页面可能已更新。")
    login_button.click()


def _erp_login_agreement_is_checked(page: Any) -> bool:
    """判断首次登录的用户协议是否已由用户确认。"""
    agreement_checkbox = _find_first_visible_locator(
        page,
        (
            "label:has-text('我已阅读并同意') input[type='checkbox']",
            "input[type='checkbox'][value='agreement']",
        ),
    )
    if agreement_checkbox is None:
        return True
    return agreement_checkbox.is_checked()


def ensure_erp_login(
    page: Any,
    credentials: ErpCredentials,
    manual_login_callback: Callable[[str], None],
) -> None:
    """复用登录状态；状态失效时自动填账号，必要时等待人工验证。"""
    page.goto(ERP_HOME_URL, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_timeout(2_000)
    if not _page_is_login_page(page):
        return
    _fill_erp_login_form(page, credentials)
    if not _erp_login_agreement_is_checked(page):
        manual_login_callback(
            "首次登录请在浏览器勾选用户协议，并点击登录。账号密码已自动填写。"
        )
        if _wait_for_condition(page, lambda: not _page_is_login_page(page), timeout_seconds=600):
            return
        raise ErpAutomationError("等待ERP首次登录确认超时。")
    _submit_erp_login(page)
    login_completed = _wait_for_condition(
        page,
        lambda: not _page_is_login_page(page),
        timeout_seconds=20,
    )
    if login_completed:
        return
    manual_login_callback(
        "ERP需要首次协议确认、验证码、短信验证，或账号信息需要核对。"
        "请在已打开的浏览器完成登录后继续。"
    )
    if not _wait_for_condition(page, lambda: not _page_is_login_page(page), timeout_seconds=600):
        raise ErpAutomationError("等待ERP人工登录超时。")


def _find_menu_search_input(page: Any) -> Any | None:
    """查找ERP左上角菜单搜索框。"""
    search_input = _find_first_visible_locator(
        page,
        (
            "input[placeholder*='搜索']",
            "input[placeholder*='菜单']",
        ),
    )
    if search_input is not None:
        return search_input
    for page_scope in _iter_page_scopes(page):
        text_inputs = page_scope.locator("input:visible")
        input_count = min(text_inputs.count(), 40)
        for input_index in range(input_count):
            input_locator = text_inputs.nth(input_index)
            bounding_box = input_locator.bounding_box()
            if bounding_box and bounding_box["x"] < 360 and bounding_box["y"] < 260:
                return input_locator
    return None


def _report_page_is_ready(page: Any) -> bool:
    """判断订单商品明细统计页面是否已打开。"""
    return _find_first_visible_text_locator(page, "CSV导出") is not None


def _wait_for_erp_home_ready(page: Any) -> bool:
    """等待ERP首页顶部标签栏渲染完成，避免登录后立即导航扑空。

    实测：登录检测完成后，ERP首页(SPA)还要约1-2秒才渲染出顶部标签栏。
    若不等，导航查找会全部扑空，误以为找不到报表页。
    返回首页是否在限时内就绪。
    """
    def erp_home_tab_bar_is_ready() -> bool:
        return (
            _find_first_visible_text_locator(page, ERP_REPORT_NAME) is not None
            or _find_first_visible_text_locator(page, "菜单") is not None
            or _find_menu_search_input(page) is not None
        )

    return _wait_for_condition(page, erp_home_tab_bar_is_ready, timeout_seconds=30)


def open_order_product_report_page(
    page: Any,
    manual_navigation_callback: Callable[[str], None],
) -> None:
    """通过ERP菜单打开订单商品明细统计页面。"""
    if _report_page_is_ready(page):
        return
    if _page_is_login_page(page):
        raise ErpAutomationError(
            "尚未完成管易ERP登录，请检查登录状态或重新运行一键智能报量。"
        )
    _wait_for_erp_home_ready(page)
    report_tab = _find_first_visible_text_locator(page, ERP_REPORT_NAME)
    if report_tab is not None:
        report_tab.click()
        if _wait_for_condition(page, lambda: _report_page_is_ready(page), timeout_seconds=20):
            return
    menu_button = _find_first_visible_text_locator(page, "菜单")
    if menu_button is not None:
        menu_button.click()
        _wait_for_condition(
            page,
            lambda: (
                _find_menu_search_input(page) is not None
                or _find_first_visible_text_locator(page, ERP_REPORT_NAME) is not None
            ),
            timeout_seconds=10,
        )
    report_menu_item = _find_first_visible_text_locator(page, ERP_REPORT_NAME)
    if report_menu_item is None:
        menu_search_input = _find_menu_search_input(page)
        if menu_search_input is not None:
            menu_search_input.fill(ERP_REPORT_NAME)
            _wait_for_condition(
                page,
                lambda: _find_first_visible_text_locator(page, ERP_REPORT_NAME) is not None,
                timeout_seconds=10,
            )
            report_menu_item = _find_first_visible_text_locator(page, ERP_REPORT_NAME)
    if report_menu_item is not None:
        report_menu_item.click()
        if _wait_for_condition(page, lambda: _report_page_is_ready(page), timeout_seconds=30):
            return
    manual_navigation_callback(
        "自动导航未找到订单商品明细统计。请在ERP中打开该页面后继续。"
    )
    if not _wait_for_condition(page, lambda: _report_page_is_ready(page), timeout_seconds=600):
        raise ErpAutomationError("等待打开订单商品明细统计页面超时。")


def _find_visible_erp_created_time_inputs(page: Any) -> tuple[Any, Any] | None:
    """查找订单商品明细统计中已挂载的两个制单时间输入框。"""
    for page_scope in _iter_page_scopes(page):
        date_input_candidates = page_scope.locator("input[name='dealDate']")
        visible_date_inputs: list[Any] = []
        for input_index in range(date_input_candidates.count()):
            date_input_candidate = date_input_candidates.nth(input_index)
            if date_input_candidate.is_visible():
                visible_date_inputs.append(date_input_candidate)
        if len(visible_date_inputs) >= 2:
            return visible_date_inputs[0], visible_date_inputs[1]
    return None


def _fill_erp_date_input(date_input: Any, date_text: str) -> None:
    """填写ERP日期控件并触发失焦确认。"""
    date_input.evaluate("element => element.removeAttribute('readonly')")
    date_input.click()
    date_input.fill(date_text)
    date_input.press("Tab")


def set_erp_created_time_range(page: Any, export_date_range: ErpExportDateRange) -> None:
    """设置订单商品明细统计的制单时间，付款时间保持不选。"""
    created_time_inputs: tuple[Any, Any] | None = None

    def created_time_inputs_are_ready() -> bool:
        nonlocal created_time_inputs
        created_time_inputs = _find_visible_erp_created_time_inputs(page)
        return created_time_inputs is not None

    if not _wait_for_condition(
        page,
        created_time_inputs_are_ready,
        timeout_seconds=30,
    ):
        raise ErpAutomationError("等待ERP制单时间控件加载超时，页面可能已更新。")
    if created_time_inputs is None:
        raise ErpAutomationError("无法识别ERP制单时间控件。")
    start_time_input, end_time_input = created_time_inputs
    _fill_erp_date_input(start_time_input, export_date_range.start_text())
    _fill_erp_date_input(end_time_input, export_date_range.end_text())


def _normalize_erp_button_text(button_text: str) -> str:
    """去掉ERP按钮文字中的排版空格。"""
    return "".join(button_text.split())


def _find_visible_erp_export_confirmation_button(page: Any) -> Any | None:
    """在当前可见的ERP导出提示中查找确认按钮。"""
    export_prompt_fragments = (
        "是否导出Excel报表",
        "导出数据用于经营分析",
    )
    for page_scope in _iter_page_scopes(page):
        modal_candidates = page_scope.locator(".ant-modal-wrap:visible")
        for modal_index in range(modal_candidates.count()):
            modal_candidate = modal_candidates.nth(modal_index)
            normalized_modal_text = _normalize_erp_button_text(
                modal_candidate.inner_text()
            )
            if not any(
                prompt_fragment in normalized_modal_text
                for prompt_fragment in export_prompt_fragments
            ):
                continue
            button_candidates = modal_candidate.locator("button:visible")
            for button_index in range(button_candidates.count()):
                button_candidate = button_candidates.nth(button_index)
                normalized_button_text = _normalize_erp_button_text(
                    button_candidate.inner_text()
                )
                if normalized_button_text in {"确定", "确认"}:
                    return button_candidate
    return None


def _erp_export_task_is_submitted(page: Any) -> bool:
    """判断ERP是否已接受本次导出任务。"""
    return (
        _find_first_visible_text_locator(
            page,
            "正在任务中心处理中",
            exact=False,
        )
        is not None
    )


def create_erp_csv_export_task(page: Any) -> datetime:
    """查询汇总并创建订单商品明细CSV导出任务。"""
    query_button = _find_first_visible_text_locator(page, "查询汇总")
    if query_button is not None:
        query_button.click()
        page.wait_for_timeout(1_000)
    csv_export_button = _find_first_visible_text_locator(page, "CSV导出")
    if csv_export_button is None:
        raise ErpAutomationError("无法识别ERP的CSV导出按钮。")
    export_started_at = datetime.now()
    csv_export_button.click()
    for _ in range(3):
        export_confirmation_button: Any | None = None
        export_task_was_submitted = False

        def export_state_is_ready() -> bool:
            nonlocal export_confirmation_button, export_task_was_submitted
            export_task_was_submitted = _erp_export_task_is_submitted(page)
            if export_task_was_submitted:
                return True
            export_confirmation_button = (
                _find_visible_erp_export_confirmation_button(page)
            )
            return export_confirmation_button is not None

        if not _wait_for_condition(
            page,
            export_state_is_ready,
            timeout_seconds=20,
            interval_seconds=0.25,
        ):
            raise ErpAutomationError("ERP没有出现导出确认提示，页面可能已更新。")
        if export_task_was_submitted:
            return export_started_at
        if export_confirmation_button is None:
            raise ErpAutomationError("无法识别ERP导出确认按钮。")
        export_confirmation_button.click()
        page.wait_for_timeout(500)
    if _wait_for_condition(
        page,
        lambda: _erp_export_task_is_submitted(page),
        timeout_seconds=20,
        interval_seconds=0.25,
    ):
        return export_started_at
    raise ErpAutomationError("ERP未确认导出任务已提交。")


def _find_erp_task_center_frame(page: Any) -> Any | None:
    """查找ERP任务中心自己的页面区域。"""
    for page_frame in page.frames:
        if ERP_TASK_CENTER_URL in page_frame.url:
            return page_frame
    return None


def _erp_task_center_is_ready(page: Any) -> bool:
    """判断ERP任务中心标签和列表是否已加载。"""
    task_center_frame = _find_erp_task_center_frame(page)
    if task_center_frame is None:
        return False
    return (
        _find_first_visible_text_locator_in_scope(
            task_center_frame,
            "任务名称",
        )
        is not None
    )


def open_erp_task_center(page: Any) -> None:
    """使用ERP自身页面消息在原窗口打开任务中心。"""
    page.evaluate(
        """taskCenterMessage => window.postMessage(
            taskCenterMessage,
            window.location.origin
        )""",
        {
            "type": "openMenuTab",
            "handlePageData": {
                "id": "taskCenter",
                "url": ERP_TASK_CENTER_URL,
                "title": "任务中心",
                "param": None,
            },
        },
    )
    task_center_tab: Any | None = None

    def task_center_tab_is_available() -> bool:
        nonlocal task_center_tab
        task_center_tab = _find_first_visible_text_locator(page, "任务中心")
        return task_center_tab is not None

    if not _wait_for_condition(
        page,
        task_center_tab_is_available,
        timeout_seconds=20,
    ):
        raise ErpAutomationError("ERP没有打开任务中心标签。")
    if task_center_tab is None:
        raise ErpAutomationError("无法识别ERP任务中心标签。")
    task_center_tab.click()
    if not _wait_for_condition(
        page,
        lambda: _erp_task_center_is_ready(page),
        timeout_seconds=30,
    ):
        raise ErpAutomationError("ERP任务中心加载超时。")
    task_center_frame = _find_erp_task_center_frame(page)
    if task_center_frame is None:
        raise ErpAutomationError("无法识别ERP任务中心页面。")
    completed_tab = _find_first_visible_text_locator_in_scope(
        task_center_frame,
        "已完成",
    )
    if completed_tab is not None:
        completed_tab.click()


def _parse_task_datetime(task_row_text: str) -> datetime | None:
    """从任务行文本解析任务创建时间。"""
    datetime_match = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})", task_row_text)
    if not datetime_match:
        return None
    try:
        return datetime.strptime(datetime_match.group(1), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _find_recent_export_task_row(page: Any, export_started_at: datetime) -> Any | None:
    """查找本次刚创建的订单商品明细导出任务。"""
    task_center_frame = _find_erp_task_center_frame(page)
    if task_center_frame is None:
        return None
    acceptable_start_time = export_started_at - timedelta(minutes=5)
    row_selector_candidates = ("tr", "[role='row']", ".x-grid-row")
    matched_rows: list[tuple[datetime, Any]] = []
    for row_selector in row_selector_candidates:
        row_candidates = task_center_frame.locator(row_selector)
        row_count = min(row_candidates.count(), 200)
        for row_index in range(row_count):
            row_locator = row_candidates.nth(row_index)
            if not row_locator.is_visible():
                continue
            row_text = row_locator.inner_text()
            if ERP_TASK_NAME not in row_text:
                continue
            task_datetime = _parse_task_datetime(row_text) or export_started_at
            if task_datetime >= acceptable_start_time:
                matched_rows.append((task_datetime, row_locator))
    if not matched_rows:
        return None
    matched_rows.sort(key=lambda matched_row: matched_row[0], reverse=True)
    return matched_rows[0][1]


def _refresh_erp_task_center(page: Any) -> None:
    """刷新ERP任务中心列表。"""
    task_center_frame = _find_erp_task_center_frame(page)
    if task_center_frame is None:
        raise ErpAutomationError("ERP任务中心页面已丢失。")
    refresh_button = _find_first_visible_text_locator_in_scope(
        task_center_frame,
        "刷新",
    )
    if refresh_button is not None:
        refresh_button.click()


def _build_unique_download_path(download_directory: Path, suggested_file_name: str) -> Path:
    """生成不会覆盖旧数据源的下载路径。"""
    safe_file_name = Path(suggested_file_name).name or "订单商品明细统计.csv"
    timestamp_text = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate_path = download_directory / f"{timestamp_text}-{safe_file_name}"
    sequence_number = 2
    while candidate_path.exists():
        candidate_path = download_directory / f"{timestamp_text}-{sequence_number}-{safe_file_name}"
        sequence_number += 1
    return candidate_path


def wait_for_erp_task_download(
    page: Any,
    export_started_at: datetime,
    download_directory: Path,
    progress_callback: Callable[[str], None],
) -> Path:
    """轮询任务中心，完成后下载本次CSV任务文件。"""
    download_directory.mkdir(parents=True, exist_ok=True)
    deadline = monotonic() + ERP_TASK_WAIT_SECONDS
    while monotonic() < deadline:
        _ensure_erp_browser_is_open(page)
        task_center_frame = _find_erp_task_center_frame(page)
        if task_center_frame is None:
            raise ErpAutomationError("ERP任务中心页面已丢失。")
        completed_tab = _find_first_visible_text_locator_in_scope(
            task_center_frame,
            "已完成",
        )
        if completed_tab is not None:
            completed_tab.click()
        task_row = _find_recent_export_task_row(page, export_started_at)
        if task_row is not None:
            task_row_text = task_row.inner_text()
            if "执行完成" in task_row_text or "下载" in task_row_text:
                download_link = task_row.get_by_text("下载", exact=True)
                download_link_count = download_link.count()
                for download_link_index in range(download_link_count):
                    visible_download_link = download_link.nth(download_link_index)
                    if not visible_download_link.is_visible():
                        continue
                    with page.expect_download(timeout=30_000) as download_event:
                        visible_download_link.click()
                    download = download_event.value
                    destination_path = _build_unique_download_path(
                        download_directory,
                        download.suggested_filename,
                    )
                    download.save_as(destination_path)
                    return normalize_erp_downloaded_source_file(destination_path)
        progress_callback("ERP任务仍在处理中，正在刷新任务中心…")
        _refresh_erp_task_center(page)
        page.wait_for_timeout(5_000)
    raise ErpAutomationError("等待ERP导出任务完成超时，请切换手动报量并检查任务中心。")


def normalize_erp_downloaded_source_file(downloaded_file_path: Path) -> Path:
    """把ERP下载结果规范为可读取的CSV；ZIP会保留并解出CSV。"""
    if not downloaded_file_path.exists() or downloaded_file_path.stat().st_size == 0:
        raise ErpAutomationError("ERP下载文件为空。")
    if downloaded_file_path.suffix.lower() == ".csv":
        return downloaded_file_path
    if downloaded_file_path.suffix.lower() == ".zip":
        with ZipFile(downloaded_file_path, "r") as downloaded_zip:
            csv_entry_names = [
                entry_name
                for entry_name in downloaded_zip.namelist()
                if Path(entry_name).suffix.lower() == ".csv"
                and not entry_name.endswith("/")
            ]
            if not csv_entry_names:
                raise ErpAutomationError("ERP下载压缩包中没有CSV文件。")
            selected_entry_name = csv_entry_names[0]
            extracted_csv_path = downloaded_file_path.with_suffix(".csv")
            extracted_csv_path.write_bytes(downloaded_zip.read(selected_entry_name))
            return extracted_csv_path
    raise ErpAutomationError(f"ERP下载了不支持的文件格式：{downloaded_file_path.name}")


def download_order_source_from_erp(
    credentials: ErpCredentials,
    browser_profile_directory: Path,
    download_directory: Path,
    progress_callback: Callable[[str], None],
    manual_action_callback: Callable[[str], None],
    reference_date: date | None = None,
) -> Path:
    """自动登录管易ERP、创建导出任务并下载订单商品明细CSV。"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise ErpAutomationError(
            "缺少ERP浏览器组件，请重新运行启动脚本完成首次安装。"
        ) from error

    credentials.validate()
    browser_profile_directory.mkdir(parents=True, exist_ok=True)
    download_directory.mkdir(parents=True, exist_ok=True)
    browser_executable_path = locate_installed_chromium_browser()
    export_date_range = build_erp_export_date_range(reference_date)
    progress_callback(
        f"ERP制单时间：{export_date_range.start_text()} 至 {export_date_range.end_text()}"
    )
    with sync_playwright() as playwright_runtime:
        browser_context = playwright_runtime.chromium.launch_persistent_context(
            **build_erp_browser_launch_options(
                browser_profile_directory=browser_profile_directory,
                browser_executable_path=browser_executable_path,
                download_directory=download_directory,
            )
        )
        try:
            page = select_single_erp_work_page(browser_context)
            maximize_erp_browser_window(browser_context, page)
            progress_callback("正在登录管易ERP…")
            ensure_erp_login(page, credentials, manual_action_callback)
            progress_callback("正在打开订单商品明细统计…")
            open_order_product_report_page(page, manual_action_callback)
            progress_callback("正在设置制单时间…")
            set_erp_created_time_range(page, export_date_range)
            progress_callback("正在创建CSV导出任务…")
            export_started_at = create_erp_csv_export_task(page)
            progress_callback("正在打开任务中心…")
            open_erp_task_center(page)
            downloaded_source_path = wait_for_erp_task_download(
                page,
                export_started_at,
                download_directory,
                progress_callback,
            )
            progress_callback(f"ERP数据源已下载：{downloaded_source_path.name}")
            return downloaded_source_path
        except ErpAutomationError:
            raise
        except Exception as error:
            if _exception_indicates_browser_closed(error):
                raise ErpBrowserClosedError(
                    "ERP浏览器已关闭，本次自动报量已取消。"
                ) from error
            raise
        finally:
            try:
                browser_context.close()
            except Exception:
                pass
