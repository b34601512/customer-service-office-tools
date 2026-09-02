function escapeKeyName(keyName) {
  return String(keyName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureReplyConfigKeyExists(content, keyName) {
  // 这里兼容老配置文件升级：新版本新增的配置项在旧文件里不存在，
  // 保存时自动追加一个占位字段，避免用户保存任意配置直接报错。
  const pattern = new RegExp(`^\\s*${escapeKeyName(keyName)}\\s*:`, "m");
  if (pattern.test(content)) {
    return content;
  }

  const anchor = "module.exports = {";
  const anchorIndex = content.indexOf(anchor);
  if (anchorIndex < 0) {
    throw new Error(`reply-config.js 结构异常：找不到「${anchor}」起始位置，无法自动补配置项。`);
  }

  const insertIndex = anchorIndex + anchor.length;
  return `${content.slice(0, insertIndex)}\n  ${keyName}: undefined,${content.slice(insertIndex)}`;
}

function getReplyConfigValue(content, keyName) {
  // 这里通过正则精确读取单个配置项，避免整份 JS 配置执行后产生隐式副作用。
  const escapedKeyName = escapeKeyName(keyName);
  const pattern = new RegExp(`(^\\s*${escapedKeyName}\\s*:\\s*)([^,\\r\\n]+)`, "m");
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`未在 reply-config.js 中找到配置项：${keyName}`);
  }

  return match[2].trim();
}

function getReplyConfigValueWithFallback(content, keyNames, defaultValue = "") {
  // 这里统一兼容新旧键名，避免控制台升级时因为配置文件还没切过去就直接读炸。
  for (const keyName of keyNames) {
    const escapedKeyName = escapeKeyName(keyName);
    const pattern = new RegExp(`(^\\s*${escapedKeyName}\\s*:\\s*)([^,\\r\\n]+)`, "m");
    const match = content.match(pattern);
    if (match) {
      return match[2].trim();
    }
  }

  return defaultValue;
}

function setReplyConfigValue(content, keyName, replacementValue) {
  // 这里统一替换单个标量配置，避免手工修改时把其他配置带坏。
  content = ensureReplyConfigKeyExists(content, keyName);
  const escapedKeyName = escapeKeyName(keyName);
  const pattern = new RegExp(`(^\\s*${escapedKeyName}\\s*:\\s*)([^,\\r\\n]+)`, "m");
  return content.replace(pattern, `$1${replacementValue}`);
}

function findReplyConfigValueRange(content, keyName) {
  // 这里按 JS 字面量边界定位配置值，专门支持关键词数组这种多行配置。
  const keyIndex = content.indexOf(`${keyName}:`);
  if (keyIndex < 0) {
    throw new Error(`未在 reply-config.js 中找到配置项：${keyName}`);
  }

  const colonIndex = content.indexOf(":", keyIndex);
  let valueStart = colonIndex + 1;
  while (/\s/.test(content[valueStart] || "")) {
    valueStart += 1;
  }

  const openingChar = content[valueStart];
  const closingCharMap = {
    "[": "]",
    "{": "}"
  };
  if (!closingCharMap[openingChar]) {
    let valueEnd = valueStart;
    while (valueEnd < content.length && content[valueEnd] !== "," && content[valueEnd] !== "\n" && content[valueEnd] !== "\r") {
      valueEnd += 1;
    }
    return {
      start: valueStart,
      end: valueEnd
    };
  }

  const closingChar = closingCharMap[openingChar];
  let depth = 0;
  let quoteChar = "";
  let escaped = false;
  for (let index = valueStart; index < content.length; index += 1) {
    const char = content[index];
    if (quoteChar) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quoteChar) {
        quoteChar = "";
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quoteChar = char;
      continue;
    }

    if (char === openingChar) {
      depth += 1;
      continue;
    }

    if (char === closingChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          start: valueStart,
          end: index + 1
        };
      }
    }
  }

  throw new Error(`配置项 ${keyName} 的数组字面量没有正确结束。`);
}

function setReplyConfigSerializedValue(content, keyName, replacementValue) {
  // 这里统一替换标量或数组配置，避免关键词配置被旧正则截断。
  content = ensureReplyConfigKeyExists(content, keyName);
  const range = findReplyConfigValueRange(content, keyName);
  return `${content.slice(0, range.start)}${replacementValue}${content.slice(range.end)}`;
}

module.exports = {
  ensureReplyConfigKeyExists,
  getReplyConfigValue,
  getReplyConfigValueWithFallback,
  setReplyConfigValue,
  findReplyConfigValueRange,
  setReplyConfigSerializedValue
};
