"""从京东页面明确标注的字段读取值；不推断企业归属或联系人身份。"""
import json
import re

ALIASES = {
    '公司名': ('公司名', '公司名称', '企业名称', '经营者名称'),
    '法人': ('法人', '法定代表人', '法定代表人姓名'),
    '公司注册时间': ('公司注册时间', '成立日期', '成立时间', '注册时间'),
    '注册资本': ('注册资本', '注册资金'),
    '电话': ('电话', '联系电话', '公司电话', '固定电话'),
    '手机': ('手机', '手机号码', '联系手机'),
    '邮箱': ('邮箱', '电子邮箱', '企业邮箱'),
    '公司地址': ('公司地址', '注册地址', '住所', '企业住所'),
    '商品评价': ('商品评价',),
    '物流履约': ('物流履约',),
    '售后服务': ('售后服务',),
}
SCORE_FIELDS = ('商品评价', '物流履约', '售后服务')
COMPANY_FIELDS = tuple(field for field in ALIASES if field not in SCORE_FIELDS)


def labeled_fields(text, fields):
    """仅支持同一行的“标签：值”或相邻行标签和值；冲突字段不采信。"""
    labels = {alias: field for field in fields for alias in ALIASES[field]}
    lines = [line.strip() for line in str(text).splitlines() if line.strip()]
    candidates = {field: set() for field in fields}
    for index, line in enumerate(lines):
        key, separator, value = line.replace('：', ':', 1).partition(':')
        key = key.strip()
        if key not in labels:
            continue
        if not separator or not value.strip():
            value = lines[index + 1] if index + 1 < len(lines) else ''
        value = value.strip()
        if not value or value.rstrip('：:') in labels or value in ('暂无', '暂无信息', '--', '-'):
            continue
        field = labels[key]
        if field in SCORE_FIELDS:
            match = re.fullmatch(r'(\d+(?:\.\d+)?)\s*分?', value)
            if not match or not 0 <= float(match[1]) <= 10:
                continue
            value = match[1]
        if len(value) <= 300:
            candidates[field].add(value)
    conflicts = [field for field, values in candidates.items() if len(values) > 1]
    return {field: next(iter(values)) for field, values in candidates.items() if len(values) == 1}, conflicts


def header_html(text):
    """京东官方getJshopHeader响应：result=true、html；不执行JSONP代码。"""
    text = text.strip()
    if not text.startswith('{'):
        match = re.fullmatch(r'[\w$]+\s*\((.*)\)\s*;?', text, re.S)
        if not match:
            raise ValueError('店铺评分头部未返回JSON/JSONP')
        text = match[1]
    data = json.loads(text)
    if not isinstance(data, dict) or data.get('result') is not True or not isinstance(data.get('html'), str):
        raise ValueError('店铺评分头部未返回有效html')
    return data['html']
