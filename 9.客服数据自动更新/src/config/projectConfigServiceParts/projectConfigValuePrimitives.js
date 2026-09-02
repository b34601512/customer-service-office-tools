// 该文件只负责项目配置值规范化、可选字段读取与深拷贝。
function normalizeString(value) {
  // 该函数只把输入规范化为去除首尾空白的字符串。
  return String(value || "").trim();
}

function normalizeColumnRef(value, fallbackValue = "") {
  // 该函数只把表格列引用规范化为大写字符串。
  return normalizeString(value || fallbackValue).toUpperCase();
}

function normalizeBoolean(value, fallbackValue = false) {
  // 该函数只把常见布尔表达规范化为布尔值。
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = normalizeString(value).toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return Boolean(fallbackValue);
}

function hasOwn(obj, key) {
  // 该函数只判断对象是否直接拥有指定字段。
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function readOptionalString(input, key, fallbackValue = "") {
  // 该函数只读取可选字符串字段并保留明确空值。
  if (hasOwn(input, key)) {
    return normalizeString(input[key]);
  }

  return normalizeString(fallbackValue);
}

function readOptionalBoolean(input, key, fallbackValue = false) {
  // 该函数只读取可选布尔字段并应用默认值。
  if (hasOwn(input, key)) {
    return normalizeBoolean(input[key], fallbackValue);
  }

  return normalizeBoolean(fallbackValue, false);
}

function clone(value) {
  // 该函数只为项目配置生成无共享引用的 JSON 副本。
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  normalizeString,
  normalizeColumnRef,
  normalizeBoolean,
  hasOwn,
  readOptionalString,
  readOptionalBoolean,
  clone
};
