from __future__ import annotations

import copy
import posixpath
import re
import shutil
import tempfile
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile


NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
ET.register_namespace("", NS_MAIN)
ET.register_namespace("r", NS_REL)

TARGET_SHEETS = {
    "2026-5",
    "2026-6",
    "2026-7",
    "2026-8",
    "2026-9",
    "2026-10",
    "2026-11",
    "2026-12",
}

SOURCE_PATH = Path(r"D:\桌面\办公软件\10.自动报量\2026年智能报量-v4.xlsx")
OUTPUT_PATH = Path(r"D:\桌面\办公软件\10.自动报量\2026年智能报量-v5.4.xlsx")
BACKUP_DIR = Path(r"D:\备份文件夹")


def log(file_line: str, module: str, action: str, detail: str) -> None:
    """按项目约定输出关键构建日志，方便定位生成过程。"""
    print(f"[{datetime.now():%H:%M:%S}][{file_line}][主线:{action}][{module}][{detail}]")


def col_to_num(column_letters: str) -> int:
    """把Excel列字母转成数字，供XML重排列坐标使用。"""
    number = 0
    for character in column_letters:
        number = number * 26 + ord(character) - 64
    return number


def num_to_col(column_number: int) -> str:
    """把列数字转成Excel列字母，供XML回写单元格地址使用。"""
    result = ""
    while column_number:
        column_number, remainder = divmod(column_number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def split_cell_reference(cell_reference: str) -> tuple[str, int]:
    """拆出单元格地址里的列和行，保持公式迁移时坐标可控。"""
    match = re.fullmatch(r"([A-Z]+)(\d+)", cell_reference)
    if not match:
        raise ValueError(f"无法解析单元格地址：{cell_reference}")
    return match.group(1), int(match.group(2))


def column_map(old_column: int) -> int | None:
    """把V4列映射到V5.3列：A:C为汇总/产品区，D起两列一天。"""
    if old_column <= 2:
        return None
    if old_column == 3:
        return 1
    if old_column == 4:
        return 2
    if old_column == 5:
        return 3
    offset = old_column - 6
    day_index = offset // 4
    position_in_day = offset % 4
    if position_in_day == 1:
        return None
    if position_in_day == 0:
        return 4 + day_index * 2
    return 5 + day_index * 2


def map_reference_token(token: str) -> str:
    """迁移本表公式里的相对坐标，外部数据源引用不在这里处理。"""
    match = re.fullmatch(r"(\$?)([A-Z]{1,3})(\$?)(\d+)", token)
    if not match:
        return token
    old_column = col_to_num(match.group(2))
    new_column = column_map(old_column)
    if new_column is None:
        return token
    return f"{match.group(1)}{num_to_col(new_column)}{match.group(3)}{match.group(4)}"


def shift_removed_row_reference_token(token: str, removed_row: int = 4) -> str:
    """删除废弃行后，把公式里的本表行号整体上移一行。"""
    match = re.fullmatch(r"(\$?)([A-Z]{1,3})(\$?)(\d+)", token)
    if not match:
        return token
    row_number = int(match.group(4))
    if row_number <= removed_row:
        return token
    return f"{match.group(1)}{match.group(2)}{match.group(3)}{row_number - 1}"


def transform_formula_references(formula: str) -> str:
    """只迁移当前报量表自身的单元格引用，避免污染数据源工作表列名。"""
    result: list[str] = []
    index = 0
    in_string = False
    while index < len(formula):
        character = formula[index]
        if character == '"':
            result.append(character)
            index += 1
            in_string = not in_string
            continue
        if in_string:
            result.append(character)
            index += 1
            continue
        if character == "'":
            end_quote = formula.find("'!", index)
            if end_quote != -1:
                result.append(formula[index : end_quote + 2])
                index = end_quote + 2
                continue
        if character == "!":
            result.append(character)
            index += 1
            continue
        match = re.match(r"(\$?[A-Z]{1,3}\$?\d+)", formula[index:])
        if match:
            previous = formula[index - 1] if index > 0 else ""
            if previous == "!":
                result.append(match.group(1))
            else:
                result.append(map_reference_token(match.group(1)))
            index += len(match.group(1))
            continue
        result.append(character)
        index += 1
    return "".join(result)


def transform_removed_row_references(formula: str, removed_row: int = 4) -> str:
    """只迁移当前报量表自身的行号引用，数据源引用不动。"""
    result: list[str] = []
    index = 0
    in_string = False
    while index < len(formula):
        character = formula[index]
        if character == '"':
            result.append(character)
            index += 1
            in_string = not in_string
            continue
        if in_string:
            result.append(character)
            index += 1
            continue
        if character == "'":
            end_quote = formula.find("'!", index)
            if end_quote != -1:
                result.append(formula[index : end_quote + 2])
                index = end_quote + 2
                continue
        match = re.match(r"(\$?[A-Z]{1,3}\$?\d+)", formula[index:])
        if match:
            previous = formula[index - 1] if index > 0 else ""
            if previous == "!":
                result.append(match.group(1))
            else:
                result.append(shift_removed_row_reference_token(match.group(1), removed_row))
            index += len(match.group(1))
            continue
        result.append(character)
        index += 1
    return "".join(result)


def decode_cell_text(cell: ET.Element, shared_strings: list[str]) -> str | None:
    """读取单元格文本，支持共享字符串和普通缓存值。"""
    value_node = cell.find(f"{{{NS_MAIN}}}v")
    if value_node is None:
        inline_node = cell.find(f"{{{NS_MAIN}}}is")
        if inline_node is None:
            return None
        return "".join(text_node.text or "" for text_node in inline_node.findall(f".//{{{NS_MAIN}}}t"))
    raw_value = value_node.text or ""
    if cell.attrib.get("t") == "s":
        return shared_strings[int(raw_value)]
    return raw_value


def set_inline_string(cell: ET.Element, value: str) -> None:
    """用内联字符串写入新文案，避免改动全局共享字符串表。"""
    for child in list(cell):
        cell.remove(child)
    cell.attrib.pop("t", None)
    cell.attrib["t"] = "inlineStr"
    inline = ET.SubElement(cell, f"{{{NS_MAIN}}}is")
    text = ET.SubElement(inline, f"{{{NS_MAIN}}}t")
    text.text = value


def set_formula(cell: ET.Element, formula: str, cached_value: str | None = None) -> None:
    """写入公式；能沿用旧缓存就沿用，避免WPS每次打开都全量重算。"""
    for child in list(cell):
        cell.remove(child)
    cell.attrib.pop("t", None)
    formula_node = ET.SubElement(cell, f"{{{NS_MAIN}}}f")
    formula_node.text = formula
    if cached_value not in (None, ""):
        value_node = ET.SubElement(cell, f"{{{NS_MAIN}}}v")
        value_node.text = str(cached_value)


def extract_ordered_product_codes(formula: str) -> list[str]:
    """从旧公式中提取料号，保持出现顺序并去重。"""
    ordered_codes: OrderedDict[str, None] = OrderedDict()
    for code in re.findall(r'"([0-9](?:\.[0-9]+){3,})"', formula):
        ordered_codes.setdefault(code, None)
    return list(ordered_codes.keys())


def unique_data_source_sheets(formula: str) -> list[str]:
    """从旧公式中提取数据源表名；V5.2只保留当前月，避免跨月重复取数。"""
    ordered_sheets: OrderedDict[str, None] = OrderedDict()
    for sheet_name in re.findall(r"'(数据源-\d{4}-\d{2})'!", formula):
        ordered_sheets.setdefault(sheet_name, None)
    return list(ordered_sheets.keys())[:1]


def current_data_source_sheet(report_sheet_name: str) -> str:
    """根据报量月表名得到唯一允许引用的数据源表名，例如2026-6只查数据源-2026-06。"""
    match = re.fullmatch(r"(\d{4})-(\d{1,2})", report_sheet_name.strip())
    if not match:
        raise ValueError(f"无法从工作表名识别月份：{report_sheet_name}")
    return f"数据源-{match.group(1)}-{int(match.group(2)):02d}"


def split_top_level_additions(formula: str) -> tuple[str, list[str]]:
    """只按顶层加号拆公式，避免拆到G$1+TIME这种函数内部加号。"""
    prefix = "=" if formula.startswith("=") else ""
    body = formula[1:] if prefix else formula
    parts: list[str] = []
    start = 0
    depth = 0
    in_string = False
    for index, character in enumerate(body):
        if character == '"':
            in_string = not in_string
        elif not in_string:
            if character in "({":
                depth += 1
            elif character in ")}" and depth > 0:
                depth -= 1
            elif character == "+" and depth == 0:
                parts.append(body[start:index])
                start = index + 1
    parts.append(body[start:])
    return prefix, parts


def keep_only_current_month_sources(formula: str, report_sheet_name: str) -> str:
    """删除产品公式里的下月数据源段，V5.2按用户确认只统计当前月数据源。"""
    allowed_source = current_data_source_sheet(report_sheet_name)
    prefix, parts = split_top_level_additions(formula)
    kept_parts: list[str] = []
    for part in parts:
        data_sources = re.findall(r"'(数据源-\d{4}-\d{2})'!", part)
        if not data_sources or allowed_source in data_sources:
            kept_parts.append(part)
    if not kept_parts:
        return "0"
    return prefix + "+".join(kept_parts)


def add_cancel_trade_deduction(formula: str) -> str:
    """在硬编码SUMIFS公式后追加同条件取消交易扣减，取消交易字段和值都直接写死。"""
    prefix, parts = split_top_level_additions(formula)
    transformed_parts: list[str] = []
    sumifs_pattern = re.compile(r"SUMIFS\((.*?)\)(?=\)|$)", re.DOTALL)
    for part in parts:
        cancel_sumifs: list[str] = []
        for match in sumifs_pattern.finditer(part):
            arguments = match.group(1)
            sheet_match = re.search(r"'(数据源-\d{4}-\d{2})'!\$AB:\$AB", arguments)
            if not sheet_match:
                continue
            sheet_prefix = f"'{sheet_match.group(1)}'!"
            cancel_arguments = arguments.replace(
                f"{sheet_prefix}$G:$G,",
                f"{sheet_prefix}$CC:$CC,\"取消交易\",{sheet_prefix}$G:$G,",
                1,
            )
            cancel_sumifs.append(f"SUMIFS({cancel_arguments})")
        if cancel_sumifs:
            transformed_parts.append(f"{part}-SUM({','.join(cancel_sumifs)})")
        else:
            transformed_parts.append(part)
    return prefix + "+".join(transformed_parts)


def extract_source_store_name(formula: str) -> str | None:
    """从V4旧公式提取数据源店铺名，避免V5直接用报量展示名导致匹配不到订单。"""
    match = re.search(r"\$B:\$B,\s*\"([^\"]+)\"", formula)
    return match.group(1) if match else None


def parse_sheet_cells(root: ET.Element, shared_strings: list[str]) -> tuple[dict[tuple[int, int], ET.Element], dict[tuple[int, int], str | None], dict[tuple[int, int], str | None]]:
    """把sheetData解析成按行列索引访问的值、公式和原始单元格。"""
    cells: dict[tuple[int, int], ET.Element] = {}
    values: dict[tuple[int, int], str | None] = {}
    formulas: dict[tuple[int, int], str | None] = {}
    for cell in root.findall(f".//{{{NS_MAIN}}}c"):
        reference = cell.attrib.get("r")
        if not reference:
            continue
        column_letters, row_number = split_cell_reference(reference)
        column_number = col_to_num(column_letters)
        key = (row_number, column_number)
        cells[key] = cell
        values[key] = decode_cell_text(cell, shared_strings)
        formula_node = cell.find(f"{{{NS_MAIN}}}f")
        formulas[key] = formula_node.text if formula_node is not None else None
    return cells, values, formulas


def find_store_rows(values: dict[tuple[int, int], str | None]) -> list[int]:
    """识别店铺块起始行，用于把汇总公式绑定到对应店铺名。"""
    store_rows: list[int] = []
    max_row = max((row for row, _ in values), default=0)
    for row_number in range(1, max_row + 1):
        store_name = values.get((row_number, 5))
        operator_label = values.get((row_number + 1, 5))
        next_row_summary_label = values.get((row_number + 1, 6))
        has_operator_label = bool(operator_label and "（" in operator_label and "运营" in operator_label)
        has_summary_label = bool(next_row_summary_label and "本店" in next_row_summary_label and "汇总" in next_row_summary_label)
        if store_name and (has_operator_label or has_summary_label):
            store_rows.append(row_number)
    return store_rows


def build_product_metadata(
    values: dict[tuple[int, int], str | None],
    formulas: dict[tuple[int, int], str | None],
    store_rows: list[int],
) -> tuple[dict[int, int], dict[int, list[str]], dict[int, list[str]]]:
    """为每个产品行建立所属店铺、料号列表和数据源列表。"""
    product_to_store_row: dict[int, int] = {}
    product_codes: dict[int, list[str]] = {}
    product_data_sources: dict[int, list[str]] = {}
    sorted_store_rows = sorted(store_rows)
    for index, store_row in enumerate(sorted_store_rows):
        next_store_row = sorted_store_rows[index + 1] if index + 1 < len(sorted_store_rows) else max((row for row, _ in values), default=store_row) + 1
        for row_number in range(store_row + 3, next_store_row):
            product_name = values.get((row_number, 5))
            if not product_name or product_name == "产品":
                continue
            formula_candidates = [
                formulas.get((row_number, column_number))
                for column_number in range(6, 150)
                if formulas.get((row_number, column_number)) and "SUMIFS" in (formulas.get((row_number, column_number)) or "")
            ]
            if not formula_candidates:
                continue
            first_formula = formula_candidates[0] or ""
            codes = extract_ordered_product_codes(first_formula)
            data_sources = unique_data_source_sheets(first_formula)
            if codes and data_sources:
                product_to_store_row[row_number] = store_row
                product_codes[row_number] = codes[:3]
                product_data_sources[row_number] = data_sources
    return product_to_store_row, product_codes, product_data_sources


def build_store_source_names(
    values: dict[tuple[int, int], str | None],
    formulas: dict[tuple[int, int], str | None],
    store_rows: list[int],
) -> dict[int, str]:
    """为每个店铺块提取数据源真实店铺名，解决报量展示名和订单店铺名不一致的问题。"""
    store_source_names: dict[int, str] = {}
    sorted_store_rows = sorted(store_rows)
    for index, store_row in enumerate(sorted_store_rows):
        next_store_row = (
            sorted_store_rows[index + 1]
            if index + 1 < len(sorted_store_rows)
            else max((row for row, _ in values), default=store_row) + 1
        )
        source_store_name: str | None = None
        for row_number in range(store_row + 3, next_store_row):
            for column_number in range(6, 150):
                formula = formulas.get((row_number, column_number))
                if formula and "SUMIFS" in formula:
                    source_store_name = extract_source_store_name(formula)
                    if source_store_name:
                        break
            if source_store_name:
                break
        display_store_name = (values.get((store_row, 5)) or "").strip()
        store_source_names[store_row] = (source_store_name or display_store_name).strip()
    return store_source_names


def create_cell(row: int, column: int, style_from: ET.Element | None = None) -> ET.Element:
    """创建新单元格，必要时复用旧样式以减少视觉变化。"""
    cell = ET.Element(f"{{{NS_MAIN}}}c", {"r": f"{num_to_col(column)}{row}"})
    if style_from is not None and "s" in style_from.attrib:
        cell.attrib["s"] = style_from.attrib["s"]
    return cell


def add_or_replace_cell(
    new_cells: dict[tuple[int, int], ET.Element],
    cell: ET.Element,
    prefer_non_empty: bool = True,
) -> None:
    """处理列压缩后同一格冲突，保留公式或非空值。"""
    column_letters, row_number = split_cell_reference(cell.attrib["r"])
    key = (row_number, col_to_num(column_letters))
    existing = new_cells.get(key)
    if existing is None:
        new_cells[key] = cell
        return
    if not prefer_non_empty:
        return
    has_formula = cell.find(f"{{{NS_MAIN}}}f") is not None
    has_value = cell.find(f"{{{NS_MAIN}}}v") is not None or cell.find(f"{{{NS_MAIN}}}is") is not None
    existing_has_formula = existing.find(f"{{{NS_MAIN}}}f") is not None
    existing_has_value = existing.find(f"{{{NS_MAIN}}}v") is not None or existing.find(f"{{{NS_MAIN}}}is") is not None
    if has_formula and not existing_has_formula:
        new_cells[key] = cell
    elif has_value and not existing_has_value:
        new_cells[key] = cell


def transform_merge_reference(reference: str, summary_rows: set[int]) -> str | None:
    """迁移合并单元格，删除白/夜班和本店汇总的冗余合并。"""
    start_reference, end_reference = reference.split(":")
    start_column_letters, start_row = split_cell_reference(start_reference)
    end_column_letters, end_row = split_cell_reference(end_reference)
    old_columns = range(col_to_num(start_column_letters), col_to_num(end_column_letters) + 1)
    mapped_columns = [column_map(old_column) for old_column in old_columns]
    mapped_columns = [column_number for column_number in mapped_columns if column_number is not None]
    if not mapped_columns:
        return None
    if start_row == end_row and start_row in summary_rows:
        return None
    new_start_column = min(mapped_columns)
    new_end_column = max(mapped_columns)
    if start_row == end_row and new_start_column == new_end_column:
        return None
    return f"{num_to_col(new_start_column)}{start_row}:{num_to_col(new_end_column)}{end_row}"


def rebuild_sheet_data(root: ET.Element, new_cells: dict[tuple[int, int], ET.Element]) -> None:
    """按新的行列坐标重建sheetData，避免保留被压缩掉的旧列。"""
    sheet_data = root.find(f"{{{NS_MAIN}}}sheetData")
    if sheet_data is None:
        raise ValueError("工作表缺少sheetData")
    for child in list(sheet_data):
        sheet_data.remove(child)
    rows: dict[int, list[ET.Element]] = {}
    for (row_number, column_number), cell in sorted(new_cells.items()):
        cell.attrib["r"] = f"{num_to_col(column_number)}{row_number}"
        rows.setdefault(row_number, []).append(cell)
    for row_number, row_cells in rows.items():
        row_element = ET.SubElement(sheet_data, f"{{{NS_MAIN}}}row", {"r": str(row_number)})
        for cell in sorted(row_cells, key=lambda element: col_to_num(split_cell_reference(element.attrib["r"])[0])):
            row_element.append(cell)


def replace_cols(root: ET.Element, max_new_column: int) -> None:
    """重建列宽：保留汇总区，日期报量列保持紧凑。"""
    existing_cols = root.find(f"{{{NS_MAIN}}}cols")
    if existing_cols is not None:
        root.remove(existing_cols)
    cols = ET.Element(f"{{{NS_MAIN}}}cols")
    column_specs = [
        (1, 1, 10),
        (2, 2, 14),
        (3, 3, 34),
        (4, max_new_column, 10),
    ]
    for min_col, max_col, width in column_specs:
        if min_col > max_new_column:
            continue
        max_col = min(max_col, max_new_column)
        cols.append(
            ET.Element(
                f"{{{NS_MAIN}}}col",
                {
                    "min": str(min_col),
                    "max": str(max_col),
                    "width": str(width),
                    "customWidth": "1",
                },
            )
        )
    sheet_data = root.find(f"{{{NS_MAIN}}}sheetData")
    insert_index = list(root).index(sheet_data) if sheet_data is not None else 0
    root.insert(insert_index, cols)


def update_dimension(root: ET.Element, max_row: int, max_column: int) -> None:
    """更新工作表使用区域，让Excel打开时定位到V5压缩后的范围。"""
    dimension = root.find(f"{{{NS_MAIN}}}dimension")
    if dimension is not None:
        dimension.attrib["ref"] = f"A1:{num_to_col(max_column)}{max_row}"


def transform_sheet_xml(
    xml_bytes: bytes,
    shared_strings: list[str],
    sheet_name: str,
) -> tuple[bytes, dict[str, int]]:
    """把单个报量月表从V4结构转换成V5结构。"""
    root = ET.fromstring(xml_bytes)
    cells, values, formulas = parse_sheet_cells(root, shared_strings)
    store_rows = find_store_rows(values)
    summary_rows = {store_row + 1 for store_row in store_rows}
    product_to_store_row, product_codes, product_data_sources = build_product_metadata(values, formulas, store_rows)
    row_map = lambda source_row: source_row - 1 if source_row > 4 else source_row
    shifted_product_to_store_row = {
        row_map(product_row): row_map(store_row)
        for product_row, store_row in product_to_store_row.items()
    }

    new_cells: dict[tuple[int, int], ET.Element] = {}
    generated_formula_count = 0
    for (row_number, old_column), original_cell in cells.items():
        if values.get((row_number, 3)) == "医用制氧机" or values.get((row_number, 5)) == "医用制氧机":
            continue
        new_column = column_map(old_column)
        if new_column is None:
            continue
        new_row_number = row_map(row_number)
        new_cell = copy.deepcopy(original_cell)
        new_cell.attrib["r"] = f"{num_to_col(new_column)}{new_row_number}"
        is_day_column = old_column >= 6
        day_position = (old_column - 6) % 4 if is_day_column else None
        formula_node = new_cell.find(f"{{{NS_MAIN}}}f")
        if formula_node is not None and formula_node.text:
            formula_node.text = transform_formula_references(formula_node.text)
            formula_node.text = transform_removed_row_references(formula_node.text, 4)
            if row_number in product_to_store_row and is_day_column and day_position in {0, 2}:
                formula_node.text = keep_only_current_month_sources(formula_node.text, sheet_name)
                formula_node.text = add_cancel_trade_deduction(formula_node.text)
                value_node = new_cell.find(f"{{{NS_MAIN}}}v")
                if value_node is not None:
                    new_cell.remove(value_node)

        if row_number in summary_rows and is_day_column:
            if day_position == 0:
                set_inline_string(new_cell, "本店汇总")
            elif day_position == 3:
                old_start_col = old_column - 3
                old_end_col = old_column
                new_start_col = column_map(old_start_col)
                new_end_col = column_map(old_end_col)
                if new_start_col and new_end_col:
                    product_rows = [
                        shifted_product_row
                        for shifted_product_row, shifted_store_row in shifted_product_to_store_row.items()
                        if shifted_store_row == row_map(row_number - 1)
                    ]
                    if product_rows:
                        set_formula(
                            new_cell,
                            f"SUM({num_to_col(new_start_col)}{min(product_rows)}:{num_to_col(new_end_col)}{max(product_rows)})",
                            values.get((row_number, old_column)),
                        )
            elif day_position == 2:
                pass

        if row_number in product_to_store_row and is_day_column and day_position in {0, 2}:
            # V5.4保留V4当前月短公式，再直接写死扣减“取消交易”。
            generated_formula_count += 1

        add_or_replace_cell(new_cells, new_cell)

    merge_node = root.find(f"{{{NS_MAIN}}}mergeCells")
    new_merge_refs: list[str] = []
    if merge_node is not None:
        for merge_cell in merge_node.findall(f"{{{NS_MAIN}}}mergeCell"):
            new_reference = transform_merge_reference(merge_cell.attrib["ref"], summary_rows)
            if new_reference and new_reference not in new_merge_refs:
                new_merge_refs.append(new_reference)
        for merge_cell in list(merge_node):
            merge_node.remove(merge_cell)
        if new_merge_refs:
            merge_node.attrib["count"] = str(len(new_merge_refs))
            for new_reference in new_merge_refs:
                ET.SubElement(merge_node, f"{{{NS_MAIN}}}mergeCell", {"ref": new_reference})
        else:
            root.remove(merge_node)

    max_row = max((row for row, _ in new_cells), default=1)
    max_column = max((column for _, column in new_cells), default=1)
    rebuild_sheet_data(root, new_cells)
    replace_cols(root, max_column)
    update_dimension(root, max_row, max_column)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True), {
        "store_blocks": len(store_rows),
        "product_rows": len(product_codes),
        "generated_formulas": generated_formula_count,
        "max_column": max_column,
    }


def load_shared_strings(zip_file: ZipFile) -> list[str]:
    """读取共享字符串表，保持原文件字符串索引可解释。"""
    shared_strings_path = "xl/sharedStrings.xml"
    if shared_strings_path not in zip_file.namelist():
        return []
    root = ET.fromstring(zip_file.read(shared_strings_path))
    return [
        "".join(text_node.text or "" for text_node in item.findall(f".//{{{NS_MAIN}}}t"))
        for item in root.findall(f"{{{NS_MAIN}}}si")
    ]


def map_sheet_paths(zip_file: ZipFile) -> dict[str, str]:
    """建立工作表名称到XML路径的映射，避免依赖固定sheet编号。"""
    workbook_root = ET.fromstring(zip_file.read("xl/workbook.xml"))
    rels_root = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
    relationship_to_target = {
        relationship.attrib["Id"]: relationship.attrib["Target"]
        for relationship in rels_root.findall(f"{{{NS_PKG_REL}}}Relationship")
    }
    sheet_paths: dict[str, str] = {}
    for sheet in workbook_root.findall(f"{{{NS_MAIN}}}sheets/{{{NS_MAIN}}}sheet"):
        relationship_id = sheet.attrib[f"{{{NS_REL}}}id"]
        target = relationship_to_target[relationship_id]
        sheet_paths[sheet.attrib["name"]] = target if target.startswith("xl/") else posixpath.normpath(f"xl/{target}")
    return sheet_paths


def remove_external_references_from_workbook(xml_bytes: bytes) -> bytes:
    """删除工作簿外部链接登记，避免WPS打开时报无法更新链接。"""
    root = ET.fromstring(xml_bytes)
    external_references = root.find(f"{{{NS_MAIN}}}externalReferences")
    if external_references is not None:
        root.remove(external_references)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def remove_external_links_from_rels(xml_bytes: bytes) -> bytes:
    """删除workbook关系里的externalLink，配合移除外部链接文件。"""
    root = ET.fromstring(xml_bytes)
    for relationship in list(root):
        if "externalLink" in relationship.attrib.get("Type", ""):
            root.remove(relationship)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def remove_external_links_from_content_types(xml_bytes: bytes) -> bytes:
    """删除内容类型里的externalLink登记，防止包内残留无效引用。"""
    root = ET.fromstring(xml_bytes)
    for override in list(root):
        if "externalLink" in override.attrib.get("ContentType", ""):
            root.remove(override)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def update_workbook_calc_settings(xml_bytes: bytes) -> bytes:
    """保持自动计算，但不要求每次打开全量重算，避免WPS打开卡很久。"""
    root = ET.fromstring(xml_bytes)
    calc_pr = root.find(f"{{{NS_MAIN}}}calcPr")
    if calc_pr is None:
        calc_pr = ET.SubElement(root, f"{{{NS_MAIN}}}calcPr")
    calc_pr.attrib["calcMode"] = "auto"
    calc_pr.attrib.pop("fullCalcOnLoad", None)
    calc_pr.attrib.pop("forceFullCalc", None)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def build_v5_workbook() -> None:
    """复制V4并生成V5，不改动原始工作簿。"""
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"找不到源文件：{SOURCE_PATH}")
    if OUTPUT_PATH.exists():
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = BACKUP_DIR / f"{OUTPUT_PATH.stem}-旧版备份-{datetime.now():%Y%m%d%H%M%S}{OUTPUT_PATH.suffix}"
        shutil.move(str(OUTPUT_PATH), str(backup_path))
        log("build_v5_workbook.py:390", "文件安全", "备份旧V5", str(backup_path))

    with tempfile.TemporaryDirectory() as temporary_directory:
        temp_output = Path(temporary_directory) / OUTPUT_PATH.name
        with ZipFile(SOURCE_PATH, "r") as source_zip:
            shared_strings = load_shared_strings(source_zip)
            sheet_paths = map_sheet_paths(source_zip)
            transformed_sheets: dict[str, bytes] = {}
            stats: dict[str, dict[str, int]] = {}
            for sheet_name in TARGET_SHEETS:
                sheet_path = sheet_paths.get(sheet_name)
                if not sheet_path:
                    continue
                transformed_xml, sheet_stats = transform_sheet_xml(
                    source_zip.read(sheet_path),
                    shared_strings,
                    sheet_name,
                )
                transformed_sheets[sheet_path] = transformed_xml
                stats[sheet_name] = sheet_stats
                log(
                    f"{OUTPUT_PATH.name}:{sheet_name}",
                    "表格改造",
                    "转换月表",
                    f"店铺{sheet_stats['store_blocks']}个 产品{sheet_stats['product_rows']}行 公式{sheet_stats['generated_formulas']}个",
                )

            workbook_xml = update_workbook_calc_settings(
                remove_external_references_from_workbook(source_zip.read("xl/workbook.xml"))
            )
            workbook_rels_xml = remove_external_links_from_rels(source_zip.read("xl/_rels/workbook.xml.rels"))
            content_types_xml = remove_external_links_from_content_types(source_zip.read("[Content_Types].xml"))

            with ZipFile(temp_output, "w", ZIP_DEFLATED) as target_zip:
                for item in source_zip.infolist():
                    if item.filename == "xl/calcChain.xml" or item.filename.startswith("xl/externalLinks/"):
                        continue
                    if item.filename == "xl/workbook.xml":
                        target_zip.writestr(item, workbook_xml)
                    elif item.filename == "xl/_rels/workbook.xml.rels":
                        target_zip.writestr(item, workbook_rels_xml)
                    elif item.filename == "[Content_Types].xml":
                        target_zip.writestr(item, content_types_xml)
                    elif item.filename in transformed_sheets:
                        target_zip.writestr(item, transformed_sheets[item.filename])
                    else:
                        target_zip.writestr(item, source_zip.read(item.filename))

        shutil.move(str(temp_output), str(OUTPUT_PATH))
    log("build_v5_workbook.py:420", "性能精简", "生成V5.4", "硬编码料号 当前月短公式 直接扣取消交易 已移除外部链接")
    log("build_v5_workbook.py:430", "文件输出", "生成V5.4", str(OUTPUT_PATH))


if __name__ == "__main__":
    build_v5_workbook()
