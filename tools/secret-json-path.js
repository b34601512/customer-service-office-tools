// 共享的 JSON 路径解析工具：供 git-secret-filter.js 与 sync-secret-store.js 复用。
// 路径语法：a.b[0]."带-引号-key"。用于按字段精确脱敏/恢复 JSON 配置里的敏感值。

function tokenize(expr) {
  const re = /([A-Za-z_$][\w$]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g;
  const tokens = [];
  let m;
  while ((m = re.exec(expr))) {
    if (m[1]) tokens.push({ type: "key", value: m[1] });
    else if (m[2]) tokens.push({ type: "index", value: Number(m[2]) });
    else if (m[3]) tokens.push({ type: "key", value: m[3].replace(/\\(["\\])/g, "$1") });
  }
  return tokens;
}

function getByPath(obj, expr) {
  let cur = obj;
  for (const t of tokenize(expr)) {
    if (cur == null) return undefined;
    cur = t.type === "index" ? cur[t.value] : cur[t.value];
  }
  return cur;
}

function setByPath(obj, expr, value) {
  const tokens = tokenize(expr);
  if (!tokens.length) return false;
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const key = t.type === "index" ? t.value : t.value;
    if (cur[key] == null) {
      const next = tokens[i + 1];
      cur[key] = next.type === "index" ? [] : {};
    }
    cur = cur[key];
  }
  const last = tokens[tokens.length - 1];
  const lastKey = last.type === "index" ? last.value : last.value;
  cur[lastKey] = value;
  return true;
}

function removeByPath(obj, expr) {
  const tokens = tokenize(expr);
  if (!tokens.length) return false;
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const key = t.type === "index" ? t.value : t.value;
    if (cur[key] == null) return false;
    cur = cur[key];
  }
  const last = tokens[tokens.length - 1];
  const lastKey = last.type === "index" ? last.value : last.value;
  if (cur == null || !(lastKey in Object(cur))) return false;
  delete cur[lastKey];
  return true;
}

module.exports = { tokenize, getByPath, setByPath, removeByPath };