from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AutoReportPaths:
    """集中保存自动报量CLI的输入、输出和运行目录。"""

    project_root_directory: Path
    source_data_directory: Path
    annual_template_workbook_path: Path
    report_config_path: Path
    order_csv_path: Path
    result_root_directory: Path
    result_workbook_directory: Path
    result_screenshot_directory: Path
    erp_source_data_directory: Path
    result_log_directory: Path
    runtime_config_directory: Path
    erp_browser_profile_directory: Path
    erp_credentials_path: Path

    @classmethod
    def from_project_root(cls, project_root_directory: Path) -> "AutoReportPaths":
        """根据项目根目录生成所有固定路径。"""
        source_data_directory = project_root_directory / "html导入工具"
        result_root_directory = project_root_directory / "自动报量输出"
        return cls(
            project_root_directory=project_root_directory,
            source_data_directory=source_data_directory,
            annual_template_workbook_path=source_data_directory / "2026年智能报量-v6.4-全年.xlsx",
            report_config_path=source_data_directory / "report-config.js",
            order_csv_path=source_data_directory / "订单商品明细统计.csv",
            result_root_directory=result_root_directory,
            result_workbook_directory=result_root_directory / "Excel结果",
            result_screenshot_directory=result_root_directory / "截图",
            erp_source_data_directory=result_root_directory / "数据源",
            result_log_directory=result_root_directory / "日志",
            runtime_config_directory=result_root_directory / "配置",
            erp_browser_profile_directory=result_root_directory / "配置" / "ERP浏览器",
            erp_credentials_path=result_root_directory / "配置" / "ERP账号.json",
        )

    def ensure_result_directories(self) -> None:
        """创建CLI运行需要的独立目录。"""
        for directory_path in (
            self.result_root_directory,
            self.result_workbook_directory,
            self.result_screenshot_directory,
            self.erp_source_data_directory,
            self.result_log_directory,
            self.runtime_config_directory,
        ):
            directory_path.mkdir(parents=True, exist_ok=True)

    def runtime_override_config_path(self) -> Path:
        """返回可选的本机配置覆盖文件路径。"""
        return self.runtime_config_directory / "报量配置覆盖.json"
