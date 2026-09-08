"""从京东页面明确标注的字段读取值；不推断企业归属或联系人身份。"""
import html
import json
import re

ALIASES = {
    '公司名': ('公司名', '公司名称', '企业名称', '经营者名称'),
    '法人': ('法人', '法定代表人', '法定代表人姓名'),
    '公司注册时间': ('公司注册时间', '成立日期', '成立时间', '注册日期', '注册时间'),
    '注册资本': ('注册资本', '注册资金'),
    '电话': ('电话', '联系电话', '公司电话', '固定电话'),
    '手机': ('手机', '手机号码', '联系手机'),
    '邮箱': ('邮箱', '电子邮箱', '企业邮箱'),
    '公司地址': ('公司地址', '注册地址', '住所', '企业住所', '经营地址', '经营场所'),
    '商品评价': ('商品评价', '商品评分'),
    '物流履约': ('物流履约', '物流评分'),
    '售后服务': ('售后服务', '售后评分'),
}
SCORE_FIELDS = ('商品评价', '物流履约', '售后服务')
COMPANY_FIELDS = tuple(field for field in ALIASES if field not in SCORE_FIELDS)

# 仅接受语义明确的结构化字段名；不使用 vendorName/shopName 等可能代表店铺简称的键。
STRUCTURED_KEYS = {
    '公司名': ('companyName', 'company_name', 'enterpriseName', 'enterprise_name'),
    '法人': ('legalPerson', 'legal_person', 'legalRepresentative', 'legal_representative'),
    '公司注册时间': ('establishedTime', 'established_time', 'establishDate', 'establish_date', 'registerDate', 'register_date'),
    '注册资本': ('registeredCapital', 'registered_capital', 'regCapital', 'reg_capital'),
    '电话': ('companyPhone', 'company_phone', 'telephone'),
    '手机': ('mobile', 'mobilePhone', 'mobile_phone'),
    '邮箱': ('email', 'companyEmail', 'company_email'),
    '公司地址': ('companyAddress', 'company_address', 'registeredAddress', 'registered_address'),
    '商品评价': ('productScore', 'product_score', 'goodsScore', 'goods_score'),
    '物流履约': ('logisticsScore', 'logistics_score', 'deliveryScore', 'delivery_score'),
    '售后服务': ('afterSaleScore', 'after_sale_score', 'afterSalesScore', 'after_sales_score'),
}

_EMPTY_VALUES = {'暂无', '暂无信息', '--', '-', '无', '未披露', 'null', 'None'}


def _clean_value(value):
    value = html.unescape(str('' if value is None else value)).replace('\u00a0', ' ')
    value = ' '.join(value.split()).strip(' ：:\t\r\n')
    return '' if value in _EMPTY_VALUES else value


def _score_value(value):
    # 只读本字段的完整评分；不能把负分、百分比或说明中的数字当作评分。
    match = re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)\s*分?(?:\s*(?:高|中|低|较高|较低|一般))?', str(value).strip())
    if not match:
        return ''
    return match[1] if 0 <= float(match[1]) <= 10 else ''


def _add_candidate(candidates, field, value):
    value = _clean_value(value)
    if not value:
        return
    if field in SCORE_FIELDS:
        value = _score_value(value)
        if not value:
            return
    if len(value) <= 300:
        candidates[field].add(value)


def _line_pairs(line, labels):
    """解析“标签：值”“标签 值”以及一行内多个标签值对。"""
    if not line:
        return []
    # 长别名优先，避免“法人”抢先匹配“法定代表人”。
    aliases = sorted(labels, key=len, reverse=True)
    alternation = '|'.join(re.escape(alias) for alias in aliases)
    # 不使用 lookbehind，兼容 Python 3.10；分隔符本身单独占 group 1。
    token = re.compile(r'(^|[\s|｜;；,，、])(' + alternation + r')(?=\s|[:：]|[0-9]|$)\s*[:：]?\s*')
    matches = list(token.finditer(line))
    pairs = []
    for index, match in enumerate(matches):
        value_start = match.end()
        value_end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
        pairs.append((match.group(2), line[value_start:value_end].strip(' ：:\t|｜;；,，、')))
    return pairs


def labeled_fields(text, fields):
    """按标签就近读取；正向与反向评分布局互斥，绝不跨标签取前缀数字。"""
    fields = tuple(fields)
    labels = {alias: field for field, aliases in ALIASES.items() for alias in aliases}
    score_aliases = '|'.join(re.escape(alias) for field in SCORE_FIELDS for alias in ALIASES[field])
    reverse = re.compile(r'([0-9]+(?:\.[0-9]+)?)\s*分?\s*(' + score_aliases + r')')
    lines = [_clean_value(line) for line in str(text or '').splitlines()]
    lines = [line for line in lines if line]
    candidates = {field: set() for field in fields}
    for index, line in enumerate(lines):
        # 反向布局必须是独立的“数值 标签”块；不能从整行前缀提取第一个数。
        reverse_matches = list(reverse.finditer(line))
        rest = reverse.sub('', line).strip(' \t|｜;；,，、')
        if reverse_matches and not rest:
            for match in reverse_matches:
                field = labels[match[2]]
                if field in candidates:
                    _add_candidate(candidates, field, match[1])
            continue
        pairs = _line_pairs(line, labels)
        for alias, value in pairs:
            field = labels[alias]
            if field not in candidates:
                continue
            if not value and index + 1 < len(lines):
                next_line = lines[index + 1]
                if not _line_pairs(next_line, labels):
                    value = next_line
            _add_candidate(candidates, field, value)
    conflicts = [field for field, values in candidates.items() if len(values) > 1]
    return {field: next(iter(values)) for field, values in candidates.items() if len(values) == 1}, conflicts


def structured_fields(document, fields):
    """从页面源码中的明确 JSON/JS 键读取字段；只接受白名单语义键。"""
    source = html.unescape(str(document or ''))
    candidates = {field: set() for field in fields}
    for field in fields:
        for key in STRUCTURED_KEYS.get(field, ()):  # quoted JSON key or JS assignment
            patterns = (
                r'["\']' + re.escape(key) + r'["\']\s*:\s*["\']([^"\']{1,300})["\']',
                r'\b' + re.escape(key) + r'\b\s*=\s*["\']([^"\']{1,300})["\']',
                r'["\']' + re.escape(key) + r'["\']\s*:\s*(-?\d+(?:\.\d+)?)',
            )
            for pattern in patterns:
                for value in re.findall(pattern, source, flags=re.I):
                    _add_candidate(candidates, field, value)
    conflicts = [field for field, values in candidates.items() if len(values) > 1]
    return {field: next(iter(values)) for field, values in candidates.items() if len(values) == 1}, conflicts


def page_fields(text, document, fields):
    """合并可见文本和结构化源码；来源冲突时明确拒绝采信。"""
    visible, visible_conflicts = labeled_fields(text, fields)
    structured, structured_conflicts = structured_fields(document, fields)
    values = {}
    conflicts = set(visible_conflicts) | set(structured_conflicts)
    for field in fields:
        found = {value for value in (visible.get(field), structured.get(field)) if value}
        if len(found) == 1 and field not in conflicts:
            values[field] = next(iter(found))
        elif len(found) > 1:
            conflicts.add(field)
    return values, sorted(conflicts)


def header_html(text):
    """京东官方getJshopHeader响应：result=true、html；不执行JSONP代码。"""
    text = str(text or '').strip()
    if not text.startswith('{'):
        match = re.fullmatch(r'[\w$]+\s*\((.*)\)\s*;?', text, re.S)
        if not match:
            raise ValueError('店铺评分头部未返回JSON/JSONP')
        text = match[1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        # 仅兼容 HTML 字符串中的原始换行/Tab；不修补截断、坏引号或执行 JSONP。
        if not exc.msg.startswith('Invalid control character'):
            raise
        data = json.loads(text, strict=False)
    if not isinstance(data, dict) or data.get('result') is not True or not isinstance(data.get('html'), str):
        raise ValueError('店铺评分头部未返回有效html')
    return data['html']
