from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree

from PIL import Image, ImageDraw, ImageFont

from auto_report_xlsx import (
    build_cell_map,
    build_cell_reference,
    read_shared_strings,
    read_workbook_sheet_paths,
)


MAIN_XML_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
THEME_XML_NAMESPACE = "http://schemas.openxmlformats.org/drawingml/2006/main"
VALUE_TAG = f"{{{MAIN_XML_NAMESPACE}}}v"
INLINE_STRING_TAG = f"{{{MAIN_XML_NAMESPACE}}}is"
ROW_TAG = f"{{{MAIN_XML_NAMESPACE}}}row"

FIRST_DATE_COLUMN_NUMBER = 6
DATE_GROUP_WIDTH = 4
MAX_RECENT_SCREENSHOT_DAYS = 3
SCREENSHOT_COLUMN_UNIT_PIXELS = 14.75
SCREENSHOT_ROW_POINT_SCALE = 2.45
SCREENSHOT_FONT_SCALE = 1.95

WINDOWS_FONT_PATHS = (
    Path("C:/Windows/Fonts/msyh.ttc"),
    Path("C:/Windows/Fonts/simhei.ttf"),
    Path("C:/Windows/Fonts/simsun.ttc"),
)


@dataclass(frozen=True)
class RenderBorder:
    """保存单条表格边框的颜色和粗细。"""

    color: tuple[int, int, int]
    width: int


@dataclass(frozen=True)
class RenderStyle:
    """保存Excel单元格转成图片时所需的样式。"""

    fill_color: tuple[int, int, int]
    font_color: tuple[int, int, int]
    font_size: float
    bold: bool
    horizontal_alignment: str
    vertical_alignment: str
    wrap_text: bool
    borders: dict[str, RenderBorder | None]


@dataclass
class RenderSheetData:
    """保存一个工作表的文字、样式、行高、列宽和合并信息。"""

    cell_map: dict[str, ElementTree.Element]
    row_map: dict[int, ElementTree.Element]
    shared_strings: list[str]
    column_widths: dict[int, float]
    column_styles: dict[int, int]
    row_heights: dict[int, float]
    hidden_rows: set[int]
    merge_ranges: list[tuple[int, int, int, int]]


@dataclass(frozen=True)
class DisplayColumn:
    """保存截图中一列对应的源工作表列。"""

    source_column_number: int
    sheet_data: RenderSheetData
    date_text: str = ""
    is_date_group_start: bool = False


def qualified_xml_name(local_name: str, namespace: str = MAIN_XML_NAMESPACE) -> str:
    """生成带命名空间的XML标签名。"""
    return f"{{{namespace}}}{local_name}"


def load_screenshot_font(font_size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """加载Windows中文字体。"""
    candidate_font_paths = WINDOWS_FONT_PATHS
    for font_path in candidate_font_paths:
        if font_path.exists():
            try:
                font_index = 0 if not bold else 1
                return ImageFont.truetype(str(font_path), font_size, index=font_index)
            except OSError:
                try:
                    return ImageFont.truetype(str(font_path), font_size, index=0)
                except OSError:
                    continue
    return ImageFont.load_default()


def apply_color_tint(color_value: tuple[int, int, int], tint_value: float) -> tuple[int, int, int]:
    """近似应用Excel主题颜色的tint。"""
    tinted_components: list[int] = []
    for component_value in color_value:
        if tint_value < 0:
            tinted_component = component_value * (1 + tint_value)
        else:
            tinted_component = component_value + (255 - component_value) * tint_value
        tinted_components.append(max(0, min(255, int(round(tinted_component)))))
    return tuple(tinted_components)


def parse_rgb_color(raw_rgb_color: str) -> tuple[int, int, int] | None:
    """读取ARGB或RGB颜色。"""
    normalized_rgb_color = (raw_rgb_color or "").strip().lstrip("#")
    if len(normalized_rgb_color) == 8:
        normalized_rgb_color = normalized_rgb_color[2:]
    if len(normalized_rgb_color) != 6:
        return None
    try:
        return tuple(
            int(normalized_rgb_color[index : index + 2], 16)
            for index in (0, 2, 4)
        )
    except ValueError:
        return None


def read_theme_colors(zip_entries: dict[str, bytes]) -> dict[int, tuple[int, int, int]]:
    """读取Excel主题色，兼容没有主题文件的情况。"""
    default_theme_colors = {
        0: (255, 255, 255),
        1: (0, 0, 0),
        2: (238, 236, 225),
        3: (31, 73, 125),
        4: (79, 129, 189),
        5: (192, 80, 77),
        6: (155, 187, 89),
        7: (128, 100, 162),
        8: (75, 172, 198),
        9: (247, 150, 70),
    }
    theme_bytes = zip_entries.get("xl/theme/theme1.xml")
    if theme_bytes is None:
        return default_theme_colors
    theme_root = ElementTree.fromstring(theme_bytes)
    color_scheme = theme_root.find(f".//{qualified_xml_name('clrScheme', THEME_XML_NAMESPACE)}")
    if color_scheme is None:
        return default_theme_colors
    theme_name_by_index = {
        0: "lt1",
        1: "dk1",
        2: "lt2",
        3: "dk2",
        4: "accent1",
        5: "accent2",
        6: "accent3",
        7: "accent4",
        8: "accent5",
        9: "accent6",
    }
    theme_colors = dict(default_theme_colors)
    for theme_index, theme_name in theme_name_by_index.items():
        color_container = color_scheme.find(qualified_xml_name(theme_name, THEME_XML_NAMESPACE))
        if color_container is None or not list(color_container):
            continue
        color_element = list(color_container)[0]
        color_value = parse_rgb_color(
            color_element.get("lastClr", "") or color_element.get("val", "")
        )
        if color_value is not None:
            theme_colors[theme_index] = color_value
    return theme_colors


def read_color_element(
    color_element: ElementTree.Element | None,
    theme_colors: dict[int, tuple[int, int, int]],
    default_color: tuple[int, int, int],
) -> tuple[int, int, int]:
    """读取rgb、theme、indexed三类Excel颜色。"""
    if color_element is None:
        return default_color
    rgb_color = parse_rgb_color(color_element.get("rgb", ""))
    if rgb_color is not None:
        color_value = rgb_color
    elif color_element.get("theme") is not None:
        color_value = theme_colors.get(int(color_element.get("theme", "0")), default_color)
    else:
        indexed_color_map = {
            0: (0, 0, 0),
            1: (255, 255, 255),
            2: (255, 0, 0),
            3: (0, 255, 0),
            4: (0, 0, 255),
            5: (255, 255, 0),
            6: (255, 0, 255),
            7: (0, 255, 255),
        }
        color_value = indexed_color_map.get(int(color_element.get("indexed", "64")), default_color)
    tint_value = float(color_element.get("tint", "0") or 0)
    return apply_color_tint(color_value, tint_value) if tint_value else color_value


def parse_render_styles(
    styles_root: ElementTree.Element,
    theme_colors: dict[int, tuple[int, int, int]],
) -> list[RenderStyle]:
    """把Excel样式表转换成图片渲染样式。"""
    fill_colors: list[tuple[int, int, int]] = []
    fills_element = styles_root.find(qualified_xml_name("fills"))
    for fill_element in fills_element.findall(qualified_xml_name("fill")) if fills_element is not None else []:
        pattern_fill = fill_element.find(qualified_xml_name("patternFill"))
        if pattern_fill is None or pattern_fill.get("patternType") != "solid":
            fill_colors.append((255, 255, 255))
            continue
        fill_colors.append(
            read_color_element(
                pattern_fill.find(qualified_xml_name("fgColor")),
                theme_colors,
                (255, 255, 255),
            )
        )

    font_values: list[tuple[tuple[int, int, int], float, bool]] = []
    fonts_element = styles_root.find(qualified_xml_name("fonts"))
    for font_element in fonts_element.findall(qualified_xml_name("font")) if fonts_element is not None else []:
        font_color = read_color_element(font_element.find(qualified_xml_name("color")), theme_colors, (0, 0, 0))
        size_element = font_element.find(qualified_xml_name("sz"))
        font_size = float(size_element.get("val", "11")) if size_element is not None else 11
        font_values.append((font_color, font_size, font_element.find(qualified_xml_name("b")) is not None))

    border_values: list[dict[str, RenderBorder | None]] = []
    borders_element = styles_root.find(qualified_xml_name("borders"))
    for border_element in borders_element.findall(qualified_xml_name("border")) if borders_element is not None else []:
        border_sides: dict[str, RenderBorder | None] = {}
        for side_name in ("left", "right", "top", "bottom"):
            side_element = border_element.find(qualified_xml_name(side_name))
            if side_element is None or side_element.get("style") is None:
                border_sides[side_name] = None
                continue
            width = {"hair": 1, "thin": 1, "medium": 2, "thick": 3}.get(side_element.get("style", "thin"), 1)
            border_sides[side_name] = RenderBorder(
                read_color_element(side_element.find(qualified_xml_name("color")), theme_colors, (180, 180, 180)),
                width,
            )
        border_values.append(border_sides)

    default_style = RenderStyle(
        fill_color=(255, 255, 255),
        font_color=(0, 0, 0),
        font_size=11,
        bold=False,
        horizontal_alignment="center",
        vertical_alignment="center",
        wrap_text=False,
        borders={side_name: None for side_name in ("left", "right", "top", "bottom")},
    )
    cell_xfs_element = styles_root.find(qualified_xml_name("cellXfs"))
    render_styles = [default_style]
    if cell_xfs_element is None:
        return render_styles
    render_styles = []
    for xf_element in cell_xfs_element.findall(qualified_xml_name("xf")):
        font_id = int(xf_element.get("fontId", "0"))
        fill_id = int(xf_element.get("fillId", "0"))
        border_id = int(xf_element.get("borderId", "0"))
        if font_id < len(font_values):
            font_color, font_size, bold = font_values[font_id]
        else:
            font_color, font_size, bold = default_style.font_color, default_style.font_size, default_style.bold
        alignment_element = xf_element.find(qualified_xml_name("alignment"))
        render_styles.append(
            RenderStyle(
                fill_color=fill_colors[fill_id] if fill_id < len(fill_colors) else default_style.fill_color,
                font_color=font_color,
                font_size=font_size,
                bold=bold,
                horizontal_alignment=alignment_element.get("horizontal", "center") if alignment_element is not None else "center",
                vertical_alignment=alignment_element.get("vertical", "center") if alignment_element is not None else "center",
                wrap_text=(alignment_element is not None and alignment_element.get("wrapText") == "1"),
                borders=border_values[border_id] if border_id < len(border_values) else default_style.borders,
            )
        )
    return render_styles


def parse_cell_range(cell_range_text: str) -> tuple[int, int, int, int] | None:
    """解析A1:E5形式的合并范围。"""
    range_parts = cell_range_text.split(":")
    if len(range_parts) != 2:
        return None
    start_match = re.fullmatch(r"([A-Z]+)(\d+)", range_parts[0])
    end_match = re.fullmatch(r"([A-Z]+)(\d+)", range_parts[1])
    if start_match is None or end_match is None:
        return None

    def column_number(column_text: str) -> int:
        result = 0
        for character in column_text:
            result = result * 26 + ord(character) - ord("A") + 1
        return result

    return (
        int(start_match.group(2)),
        int(end_match.group(2)),
        column_number(start_match.group(1)),
        column_number(end_match.group(1)),
    )


def load_render_sheet_data(
    zip_entries: dict[str, bytes],
    sheet_path: str,
    shared_strings: list[str],
) -> RenderSheetData:
    """读取工作表渲染所需的结构信息。"""
    sheet_root = ElementTree.fromstring(zip_entries[sheet_path])
    cell_map = build_cell_map(sheet_root)
    sheet_data_element = sheet_root.find(f".//{qualified_xml_name('sheetData')}")
    row_map = {
        int(row_element.get("r", "0")): row_element
        for row_element in sheet_data_element.findall(ROW_TAG)
    } if sheet_data_element is not None else {}
    sheet_format_element = sheet_root.find(qualified_xml_name("sheetFormatPr"))
    default_row_height = float(sheet_format_element.get("defaultRowHeight", "19.5")) if sheet_format_element is not None else 19.5
    row_heights: dict[int, float] = {}
    hidden_rows: set[int] = set()
    for row_number, row_element in row_map.items():
        row_heights[row_number] = float(row_element.get("ht", default_row_height))
        if row_element.get("hidden") == "1":
            hidden_rows.add(row_number)

    default_column_width = float(sheet_format_element.get("defaultColWidth", "9")) if sheet_format_element is not None else 9
    column_widths = {column_number: default_column_width for column_number in range(1, 200)}
    column_styles = {column_number: 0 for column_number in range(1, 200)}
    columns_element = sheet_root.find(qualified_xml_name("cols"))
    if columns_element is not None:
        for column_element in columns_element.findall(qualified_xml_name("col")):
            minimum_column = int(column_element.get("min", "1"))
            maximum_column = int(column_element.get("max", minimum_column))
            column_width = float(column_element.get("width", default_column_width))
            column_style = int(column_element.get("style", "0"))
            for column_number in range(minimum_column, maximum_column + 1):
                column_widths[column_number] = column_width
                column_styles[column_number] = column_style

    merge_ranges: list[tuple[int, int, int, int]] = []
    merge_cells_element = sheet_root.find(qualified_xml_name("mergeCells"))
    if merge_cells_element is not None:
        for merge_cell_element in merge_cells_element.findall(qualified_xml_name("mergeCell")):
            parsed_range = parse_cell_range(merge_cell_element.get("ref", ""))
            if parsed_range is not None:
                merge_ranges.append(parsed_range)
    return RenderSheetData(
        cell_map=cell_map,
        row_map=row_map,
        shared_strings=shared_strings,
        column_widths=column_widths,
        column_styles=column_styles,
        row_heights=row_heights,
        hidden_rows=hidden_rows,
        merge_ranges=merge_ranges,
    )


def read_render_cell_text(sheet_data: RenderSheetData, cell_reference: str) -> str:
    """读取单元格文字、共享字符串或公式缓存值。"""
    cell_element = sheet_data.cell_map.get(cell_reference)
    if cell_element is None:
        return ""
    value_element = cell_element.find(VALUE_TAG)
    if cell_element.get("t") == "inlineStr":
        inline_string_element = cell_element.find(INLINE_STRING_TAG)
        return "".join(inline_string_element.itertext()) if inline_string_element is not None else ""
    if value_element is None:
        return ""
    raw_value = value_element.text or ""
    if cell_element.get("t") == "s":
        shared_string_index = int(raw_value or 0)
        return sheet_data.shared_strings[shared_string_index] if shared_string_index < len(sheet_data.shared_strings) else ""
    return raw_value


def get_cell_style_id(sheet_data: RenderSheetData, cell_reference: str) -> int:
    """按单元格、行、列顺序取得Excel样式编号。"""
    cell_element = sheet_data.cell_map.get(cell_reference)
    if cell_element is not None and cell_element.get("s") is not None:
        return int(cell_element.get("s", "0"))
    row_match = re.search(r"\d+", cell_reference)
    row_number = int(row_match.group()) if row_match is not None else 0
    row_element = sheet_data.row_map.get(row_number)
    if row_element is not None and row_element.get("s") is not None and row_element.get("customFormat") == "1":
        return int(row_element.get("s", "0"))
    column_match = re.match(r"([A-Z]+)", cell_reference)
    if column_match is None:
        return 0
    column_number = 0
    for character in column_match.group(1):
        column_number = column_number * 26 + ord(character) - ord("A") + 1
    return sheet_data.column_styles.get(column_number, 0)


def get_style_for_cell(
    sheet_data: RenderSheetData,
    cell_reference: str,
    render_styles: list[RenderStyle],
) -> RenderStyle:
    """读取目标单元格对应的图片样式。"""
    style_id = get_cell_style_id(sheet_data, cell_reference)
    return render_styles[style_id] if style_id < len(render_styles) else render_styles[0]


def format_result_number(raw_text: str) -> str:
    """把报量数量格式化为表格中的简洁数字。"""
    try:
        numeric_value = float(raw_text or 0)
    except ValueError:
        return raw_text
    if numeric_value == int(numeric_value):
        return str(int(numeric_value))
    return f"{numeric_value:.4f}".rstrip("0").rstrip(".")


def _is_date_serial(raw_text: str, date_text: str) -> bool:
    """判断单元格原始值是否等于该日期列对应的Excel串行号（如46238对应2026-08-04）。"""
    if not raw_text:
        return False
    try:
        target_date = date.fromisoformat(date_text)
        expected_serial = (target_date - date(1899, 12, 30)).days
        return float(raw_text) == float(expected_serial)
    except (ValueError, TypeError):
        return False


def format_render_cell_text(
    raw_text: str,
    display_column: DisplayColumn,
) -> str:
    """把原始单元格值转换成老板截图中可读的文字。"""
    if display_column.date_text and display_column.is_date_group_start and _is_date_serial(raw_text, display_column.date_text):
        target_date = date.fromisoformat(display_column.date_text)
        return f"{target_date.month}月{target_date.day}日"
    if not raw_text:
        return ""
    if re.fullmatch(r"-?\d+(\.\d+)?", raw_text):
        return format_result_number(raw_text)
    return raw_text


def build_recent_date_texts(start_date: date, end_date: date) -> list[str]:
    """取得所选范围最后三天，作为截图展示列。"""
    all_date_texts: list[str] = []
    current_date = start_date
    while current_date <= end_date:
        all_date_texts.append(current_date.isoformat())
        current_date += timedelta(days=1)
    return all_date_texts[-MAX_RECENT_SCREENSHOT_DAYS:]


def build_display_columns(
    recent_date_texts: list[str],
    sheet_data_by_name: dict[str, RenderSheetData],
) -> list[DisplayColumn]:
    """建立基础字段加最后三天白夜班字段的截图列。"""
    if not recent_date_texts:
        raise ValueError("截图没有可展示的日期。")
    first_date = date.fromisoformat(recent_date_texts[0])
    base_sheet_data = sheet_data_by_name.get(f"{first_date.year}-{first_date.month}")
    if base_sheet_data is None:
        raise RuntimeError(f"截图缺少工作表：{first_date.year}-{first_date.month}")
    display_columns = [
        DisplayColumn(column_number, base_sheet_data)
        for column_number in range(3, 6)
    ]
    for date_text in recent_date_texts:
        target_date = date.fromisoformat(date_text)
        sheet_data = sheet_data_by_name.get(f"{target_date.year}-{target_date.month}")
        if sheet_data is None:
            raise RuntimeError(f"截图缺少工作表：{target_date.year}-{target_date.month}")
        group_start_column = FIRST_DATE_COLUMN_NUMBER + (target_date.day - 1) * DATE_GROUP_WIDTH
        display_columns.extend(
            DisplayColumn(
                group_start_column + offset,
                sheet_data,
                date_text=date_text,
                is_date_group_start=offset == 0,
            )
            for offset in range(DATE_GROUP_WIDTH)
        )
    return display_columns


def build_visible_row_positions(
    sheet_data: RenderSheetData,
    maximum_row_number: int,
) -> tuple[list[int], dict[int, tuple[int, int]]]:
    """建立不含隐藏行的截图纵向位置。"""
    visible_row_numbers: list[int] = []
    row_positions: dict[int, tuple[int, int]] = {}
    current_top = 0
    for row_number in range(1, maximum_row_number + 1):
        if row_number in sheet_data.hidden_rows:
            continue
        row_height = sheet_data.row_heights.get(row_number, 19.5)
        row_height_pixels = max(20, int(round(row_height * SCREENSHOT_ROW_POINT_SCALE)))
        visible_row_numbers.append(row_number)
        row_positions[row_number] = (current_top, current_top + row_height_pixels)
        current_top += row_height_pixels
    return visible_row_numbers, row_positions


def build_column_positions(
    display_columns: list[DisplayColumn],
) -> tuple[list[int], dict[int, tuple[int, int]]]:
    """建立截图横向列位置。"""
    column_positions: dict[int, tuple[int, int]] = {}
    current_left = 0
    for display_index, display_column in enumerate(display_columns):
        column_width = display_column.sheet_data.column_widths.get(display_column.source_column_number, 9)
        column_width_pixels = max(30, int(round(column_width * SCREENSHOT_COLUMN_UNIT_PIXELS)))
        column_positions[display_index] = (current_left, current_left + column_width_pixels)
        current_left += column_width_pixels
    return [column_positions[index][0] for index in range(len(display_columns))], column_positions


def build_render_merge_map(
    sheet_data: RenderSheetData,
    display_columns: list[DisplayColumn],
    context_display_indexes: list[int],
) -> dict[tuple[int, int], tuple[int, int, int, int]]:
    """只保留完全位于截图列范围内的合并单元格。"""
    selected_source_columns = {
        display_columns[display_index].source_column_number
        for display_index in context_display_indexes
    }
    display_index_by_source_column = {
        display_columns[display_index].source_column_number: display_index
        for display_index in context_display_indexes
    }
    merge_map: dict[tuple[int, int], tuple[int, int, int, int]] = {}
    for min_row, max_row, min_column, max_column in sheet_data.merge_ranges:
        if not all(column_number in selected_source_columns for column_number in range(min_column, max_column + 1)):
            continue
        if min_column not in display_index_by_source_column or max_column not in display_index_by_source_column:
            continue
        render_range = (
            min_row,
            max_row,
            display_index_by_source_column[min_column],
            display_index_by_source_column[max_column],
        )
        for row_number in range(min_row, max_row + 1):
            for column_number in range(min_column, max_column + 1):
                merge_map[(row_number, column_number)] = render_range
    return merge_map


def get_cell_element_text_and_style(
    display_column: DisplayColumn,
    row_number: int,
    render_styles: list[RenderStyle],
) -> tuple[str, RenderStyle]:
    """读取一格的显示文字和样式。"""
    cell_reference = build_cell_reference(display_column.source_column_number, row_number)
    raw_text = read_render_cell_text(display_column.sheet_data, cell_reference)
    display_text = format_render_cell_text(raw_text, display_column)
    return display_text, get_style_for_cell(display_column.sheet_data, cell_reference, render_styles)


def fit_text_lines(
    draw_context: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    available_width: int,
    maximum_line_count: int,
) -> list[str]:
    """把长产品名压缩成不溢出单元格的文字行。"""
    if not text:
        return []
    if draw_context.textbbox((0, 0), text, font=font)[2] <= available_width:
        return [text]
    lines: list[str] = []
    current_line = ""
    for character in text:
        candidate_line = current_line + character
        if current_line and draw_context.textbbox((0, 0), candidate_line, font=font)[2] > available_width:
            lines.append(current_line)
            current_line = character
            if len(lines) >= maximum_line_count - 1:
                break
        else:
            current_line = candidate_line
    if current_line and len(lines) < maximum_line_count:
        lines.append(current_line)
    if len(lines) == maximum_line_count and len("".join(lines)) < len(text):
        lines[-1] = lines[-1][:-1] + "…"
    return lines or [text[:1]]


def draw_render_cell(
    draw_context: ImageDraw.ImageDraw,
    rectangle: tuple[int, int, int, int],
    display_text: str,
    render_style: RenderStyle,
) -> None:
    """绘制单元格背景、边框和文字。"""
    left, top, right, bottom = rectangle
    draw_context.rectangle(rectangle, fill=render_style.fill_color)
    default_border = RenderBorder((190, 198, 208), 1)
    for side_name, start_point, end_point in (
        ("top", (left, top), (right, top)),
        ("bottom", (left, bottom - 1), (right, bottom - 1)),
        ("left", (left, top), (left, bottom)),
        ("right", (right - 1, top), (right - 1, bottom)),
    ):
        border = render_style.borders.get(side_name) or default_border
        draw_context.line((start_point, end_point), fill=border.color, width=border.width)
    if not display_text:
        return
    font_size = max(12, int(round(render_style.font_size * SCREENSHOT_FONT_SCALE)))
    font = load_screenshot_font(font_size, render_style.bold)
    available_width = max(10, right - left - 12)
    lines = fit_text_lines(draw_context, display_text, font, available_width, 2 if render_style.wrap_text else 1)
    line_height = max(14, font_size + 3)
    text_height = line_height * len(lines)
    if render_style.vertical_alignment == "top":
        text_top = top + 4
    elif render_style.vertical_alignment == "bottom":
        text_top = bottom - text_height - 4
    else:
        text_top = top + max(2, (bottom - top - text_height) // 2)
    for line_index, line_text in enumerate(lines):
        text_bbox = draw_context.textbbox((0, 0), line_text, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        if render_style.horizontal_alignment == "left":
            text_left = left + 6
        elif render_style.horizontal_alignment == "right":
            text_left = right - text_width - 6
        else:
            text_left = left + max(3, (right - left - text_width) // 2)
        draw_context.text(
            (text_left, text_top + line_index * line_height),
            line_text,
            fill=render_style.font_color,
            font=font,
        )


def draw_result_page_table(
    display_columns: list[DisplayColumn],
    render_styles: list[RenderStyle],
    visible_row_numbers: list[int],
    row_positions: dict[int, tuple[int, int]],
    column_positions: dict[int, tuple[int, int]],
    merge_maps_by_context: dict[int, dict[tuple[int, int], tuple[int, int, int, int]]],
) -> Image.Image:
    """绘制完整报量结果表长图。"""
    canvas_width = column_positions[len(display_columns) - 1][1]
    canvas_height = row_positions[visible_row_numbers[-1]][1]
    result_image = Image.new("RGB", (canvas_width, canvas_height), (255, 255, 255))
    draw_context = ImageDraw.Draw(result_image)
    rendered_merged_ranges: set[tuple[int, int, int, int, int]] = set()
    for row_number in visible_row_numbers:
        row_top, row_bottom = row_positions[row_number]
        for display_index, display_column in enumerate(display_columns):
            merge_map = merge_maps_by_context[id(display_column.sheet_data)]
            merge_range = merge_map.get((row_number, display_column.source_column_number))
            if merge_range is not None:
                min_row, max_row, start_display_index, end_display_index = merge_range
                range_key = (min_row, max_row, start_display_index, end_display_index, id(display_column.sheet_data))
                if range_key in rendered_merged_ranges:
                    continue
                rendered_merged_ranges.add(range_key)
                if row_number != min_row or display_index != start_display_index:
                    continue
                merge_top = row_positions.get(min_row, (row_top, row_bottom))[0]
                merge_bottom = row_positions.get(max_row, (row_top, row_bottom))[1]
                merge_left = column_positions[start_display_index][0]
                merge_right = column_positions[end_display_index][1]
                display_text, render_style = get_cell_element_text_and_style(
                    display_column,
                    min_row,
                    render_styles,
                )
                draw_render_cell(
                    draw_context,
                    (merge_left, merge_top, merge_right, merge_bottom),
                    display_text,
                    render_style,
                )
                continue
            if (row_number, display_column.source_column_number) in merge_map:
                continue
            display_text, render_style = get_cell_element_text_and_style(
                display_column,
                row_number,
                render_styles,
            )
            column_left, column_right = column_positions[display_index]
            draw_render_cell(
                draw_context,
                (column_left, row_top, column_right, row_bottom),
                display_text,
                render_style,
            )
    return result_image


def find_last_screenshot_content_row(display_columns: list[DisplayColumn]) -> int:
    """按截图可见的业务列定位末行，忽略模板底部隐藏辅助值。"""
    business_display_columns = display_columns
    maximum_row_number = max(
        (
            max(display_column.sheet_data.row_map, default=1)
            for display_column in business_display_columns
        ),
        default=1,
    )
    for row_number in range(maximum_row_number, 0, -1):
        for display_column in business_display_columns:
            cell_reference = build_cell_reference(
                display_column.source_column_number,
                row_number,
            )
            if read_render_cell_text(display_column.sheet_data, cell_reference).strip():
                return row_number
    return 1


def build_result_page_screenshot_bytes(
    start_date: date,
    end_date: date,
    output_workbook_bytes: bytes,
) -> bytes:
    """生成保留Excel原表样式、展示最后三天数据的汇报长图。"""
    with ZipFile(BytesIO(output_workbook_bytes), "r") as workbook_zip:
        zip_entries = {
            entry_name: workbook_zip.read(entry_name)
            for entry_name in workbook_zip.namelist()
        }
    shared_strings = read_shared_strings(zip_entries)
    sheet_paths_by_name = read_workbook_sheet_paths(zip_entries)
    recent_date_texts = build_recent_date_texts(start_date, end_date)
    required_sheet_names = {
        f"{target_date.year}-{target_date.month}"
        for target_date in (date.fromisoformat(date_text) for date_text in recent_date_texts)
    }
    sheet_data_by_name = {
        sheet_name: load_render_sheet_data(zip_entries, sheet_paths_by_name[sheet_name], shared_strings)
        for sheet_name in required_sheet_names
    }
    display_columns = build_display_columns(recent_date_texts, sheet_data_by_name)
    base_sheet_data = display_columns[0].sheet_data
    maximum_row_number = find_last_screenshot_content_row(display_columns)
    visible_row_numbers, row_positions = build_visible_row_positions(base_sheet_data, maximum_row_number)
    _, column_positions = build_column_positions(display_columns)
    theme_colors = read_theme_colors(zip_entries)
    styles_root = ElementTree.fromstring(zip_entries["xl/styles.xml"])
    render_styles = parse_render_styles(styles_root, theme_colors)
    context_display_indexes: dict[int, list[int]] = {}
    for display_index, display_column in enumerate(display_columns):
        context_display_indexes.setdefault(id(display_column.sheet_data), []).append(display_index)
    merge_maps_by_context = {
        context_id: build_render_merge_map(
            display_columns[indexes[0]].sheet_data,
            display_columns,
            indexes,
        )
        for context_id, indexes in context_display_indexes.items()
    }
    result_image = draw_result_page_table(
        display_columns,
        render_styles,
        visible_row_numbers,
        row_positions,
        column_positions,
        merge_maps_by_context,
    )
    with BytesIO() as output_stream:
        result_image.save(output_stream, format="PNG", optimize=True)
        return output_stream.getvalue()
