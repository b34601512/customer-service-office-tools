# 该文件用于集中保存 ERP 页面识别和日志常量。
from __future__ import annotations

MODULE_NAME = "refund_reminder.erp_page"
# 单一真源在 erp_navigation.py（菜单搜索进入订单页的同一关键字），此处复用避免双真源漂移。
from ..erp_navigation import ORDER_QUERY_KEYWORD

ORDER_PAGE_LANDMARKS = ("默认筛选", "单据时间", "订单明细", "商品明细", "新增", "审核", "反审核", "发货状态", "配货状态")
LOGIN_WAIT_PAGE_MARKERS = ("淘宝账号登录", "账户登录", "租户登录", "点击使用淘宝账号登录", "我已阅读并同意", "用户协议", "隐私政策", "申请试用")
PUBLIC_SITE_MARKERS = ("网站首页", "产品中心", "解决方案", "标杆案例", "服务保障", "关于我们")

__all__ = [
    "LOGIN_WAIT_PAGE_MARKERS",
    "MODULE_NAME",
    "ORDER_PAGE_LANDMARKS",
    "ORDER_QUERY_KEYWORD",
    "PUBLIC_SITE_MARKERS",
]
