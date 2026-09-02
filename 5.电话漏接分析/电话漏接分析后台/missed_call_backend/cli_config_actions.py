"""旧版行式 CLI 的配置类操作，独立成模块以控制主文件体积。"""
from __future__ import annotations

from pathlib import Path
import re
from typing import Any

from .cli_display import print_menu, print_message, print_table, print_title
from .cli_input import prompt_menu_choice, prompt_secret, prompt_text, wait_for_enter
from .download_tasks import open_original_system_login_browser
from .state_store import (
    load_agent_mapping,
    load_complaint_config,
    load_download_config,
    save_agent_mapping,
    save_complaint_config,
    save_download_config,
)


def show_config_menu(app: Any) -> None:
    """集中管理下载、座席、投诉、口径等低频配置。"""
    while True:
        config = load_download_config()
        print_title("配置")
        print_table(
            ["配置", "当前值"],
            [["系统地址", config.get("baseUrl", "")], ["下载天数", config.get("days", 30)], ["账号", config.get("account", "")], ["密码", "已保存" if config.get("password") else "未配置"]],
        )
        print_menu([("1", "下载配置"), ("2", "座席号映射"), ("3", "投诉电话座席分机"), ("4", "判断口径"), ("5", "打开并登录原系统"), ("6", "查看最近日志"), ("0", "返回")])
        choice = prompt_menu_choice("请选择：", {"0", "1", "2", "3", "4", "5", "6"}, "0")
        if choice == "0":
            return
        if choice == "1":
            edit_download_config(app)
        elif choice == "2":
            edit_agent_mapping(app)
        elif choice == "3":
            edit_complaint_config(app)
        elif choice == "4":
            show_rules(app)
        elif choice == "5":
            open_original_login(app)
        else:
            show_recent_log(app)


def edit_download_config(app: Any) -> None:
    """修改网页原配置面板中的下载配置。"""
    current = load_download_config()
    next_config = {
        "baseUrl": prompt_text(f"系统地址（回车保留 {current.get('baseUrl', '')}）：", str(current.get("baseUrl") or "")),
        "days": prompt_text(f"下载最近几天（1-365，回车保留 {current.get('days', 30)}）：", str(current.get("days", 30))),
        "companyCode": prompt_text("公司代码（回车保留）：", str(current.get("companyCode") or "")),
        "account": prompt_text("账号（回车保留）：", str(current.get("account") or "")),
        "password": prompt_secret("密码（回车保留当前密码）：", str(current.get("password") or "")),
    }
    try:
        next_config["days"] = int(next_config["days"])
        saved = save_download_config(next_config)
        print_message(f"下载配置已保存，最近{saved['days']}天。", "success")
    except Exception as error:
        print_message(str(error), "error")


def open_original_login(app: Any) -> None:
    """打开原系统并复用现有登录态。"""
    try:
        payload = open_original_system_login_browser()
        print_message(str(payload.get("message") or "已打开原系统"), "success")
    except Exception as error:
        print_message(str(error), "error")
    wait_for_enter("按回车返回...")


def show_recent_log(app: Any) -> None:
    """显示当前运行日志末尾，保留网页日志面板的用途。"""
    log_file = Path(__file__).resolve().parent.parent / "运行日志.log"
    if not log_file.exists():
        print_message("暂无运行日志。", "warning")
    else:
        print(log_file.read_text(encoding="utf-8", errors="replace")[-12000:])
    wait_for_enter("按回车返回...")


def edit_agent_mapping(app: Any) -> None:
    """编辑座席分机到当前姓名的映射。"""
    current = load_agent_mapping()
    next_mapping: dict[str, str] = {}
    print_table(["分机", "当前姓名"], [[extension, name] for extension, name in sorted(current.items())])
    for extension, name in sorted(current.items()):
        value = prompt_text(f"{extension} 当前“{name}”（回车保留，输入-删除）：", "")
        if value != "-":
            next_mapping[extension] = name if not value else value
    while True:
        value = prompt_text("新增映射（格式 分机=姓名，多个分机用逗号分隔，回车结束）：", "")
        if not value:
            break
        if "=" not in value:
            print_message("格式应为：分机=姓名", "warning")
            continue
        extension_text, name = value.split("=", 1)
        name = name.strip()
        extensions = [part.strip() for part in re.split(r"[,，、]", extension_text) if part.strip()]
        if not extensions or not name:
            print_message("分机和姓名都不能为空", "warning")
            continue
        for extension in extensions:
            next_mapping[extension] = name
    saved = save_agent_mapping(next_mapping)
    print_message(f"已保存 {len(saved)} 条座席映射。", "success")
    app.cached_call_records = None


def edit_complaint_config(app: Any) -> None:
    """编辑投诉电话对应的座席分机。"""
    current = load_complaint_config()
    current_text = "、".join(current.get("receiverPhones") or [])
    value = prompt_text(f"投诉座席分机（逗号分隔，回车保留 {current_text}）：", current_text)
    try:
        saved = save_complaint_config({"receiverPhones": value})
        print_message(f"已保存投诉座席分机：{'、'.join(saved['receiverPhones'])}", "success")
        app.refresh_result()
    except Exception as error:
        print_message(str(error), "error")


def show_rules(app: Any) -> None:
    """显示当前项目的判断口径。"""
    result = app.latest_result or {}
    complaints = result.get("complaints") or {}
    receiver_text = "、".join(complaints.get("receiverPhones") or load_complaint_config().get("receiverPhones") or [])
    print_title("判断口径")
    for index, rule in enumerate(
        [
            "同一号码在当前导入范围内发生1次及以上呼损，就进入待处理清单。",
            "成功呼入不再作为排除条件，只标记最终已呼入或曾成功呼入。",
            "呼损次数统计当前导入范围内该号码的全部呼损。",
            "优先级由呼损次数、累计等待、排队阶段次数、最近发生时间共同决定。",
            f"投诉电话只统计呼入明细里座席分机属于 {receiver_text or '未配置'} 的记录。",
        ],
        1,
    ):
        print(f"{index}. {rule}")
    wait_for_enter("按回车返回...")
