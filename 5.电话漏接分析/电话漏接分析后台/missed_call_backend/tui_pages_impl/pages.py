"""TUI 页面装配入口。"""
from __future__ import annotations

from ..tui_app import Page
from .analytics import AgentsPage, MonthlyPage, TrendsPage
from .config import ConfigPage
from .download import DownloadPage
from .exit_page import ExitPage
from .raw_tables import InboundPage, LossPage, OutboundPage


def create_pages() -> list[Page]:
    """创建 TUI 使用的全部页面：原始三表直显 + 客服/趋势分析 + 下载/配置/退出。"""
    return [
        InboundPage(),
        OutboundPage(),
        LossPage(),
        AgentsPage(),
        TrendsPage(),
        MonthlyPage(),
        DownloadPage(),
        ConfigPage(),
        ExitPage(),
    ]
