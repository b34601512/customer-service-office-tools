#!/usr/bin/env node
// 提交时剔除敏感字段（clean），检出时从本地未入库的 store 恢复（smudge）。
// 用法：node tools/git-secret-filter.js clean|smudge %f（git filter 调用，stdin 输入、stdout 输出）
// 路径由 .git/config 的 filter.kdocs-secret.clean/smudge 传入（%f 占位符）。
// 敏感字段清单见 tools/git-secret-store.json（不入库），用 tools/sync-secret-store.js 从磁盘真值重建。

const fs = require("fs");
const path = require("path");
const { getByPath, setByPath, removeByPath } = require("./secret-json-path");

const mode = process.argv[2];
const rawPath = process.argv[3] || "";
const filePath = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
const STORE_PATH = path.join(__dirname, "git-secret-store.json");

const KEY_RE = /\["((?:[^"\\]|\\.)*)"\]$/;

function lastKey(expr) {
  const m = KEY_RE.exec(expr);
  return m ? m[1].replace(/\\(["\\])/g, "$1") : null;
}

function parentExpr(expr) {
  const i = expr.lastIndexOf('["');
  return i === -1 ? expr : expr.slice(0, i);
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch (err) {
    return {};
  }
}

function collectFields(entry) {
  // v2：fields 数组 [{path, value, placeholder?}]；v1：{webhookUrl: "...", apiToken: "..."}
  if (Array.isArray(entry && entry.fields)) return entry.fields;
  if (entry && typeof entry === "object") {
    return Object.keys(entry).map((k) => ({ path: k, value: entry[k] }));
  }
  return [];
}

function processContent(content) {
  const entry = readStore()[filePath];
  const fields = collectFields(entry);
  if (!fields.length) return content;

  const hadBom = content.charCodeAt(0) === 0xfeff;
  const body = hadBom ? content.slice(1) : content;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return content; // 非 JSON 文件直接透传，不影响普通文件
  }

  const isClean = mode === "clean";
  let dirty = false;
  for (const f of fields) {
    if (f.keyMask !== undefined) {
      // 键名打码：把手机号形式的键名替换为占位名（clean），检出时还原（smudge）
      const key = lastKey(f.path);
      const parent = parentExpr(f.path);
      if (key === null) continue;
      const maskedKey = String(f.keyMask);
      if (isClean) {
        const realVal = getByPath(parsed, parent + `["${key}"]`);
        if (realVal === undefined || key === maskedKey) continue;
        setByPath(parsed, parent + `["${maskedKey}"]`, f.placeholder !== undefined ? f.placeholder : "");
        removeByPath(parsed, parent + `["${key}"]`);
        dirty = true;
      } else {
        if (key === maskedKey) continue;
        const maskedVal = getByPath(parsed, parent + `["${maskedKey}"]`);
        if (maskedVal === undefined) continue;
        setByPath(parsed, parent + `["${key}"]`, f.value);
        removeByPath(parsed, parent + `["${maskedKey}"]`);
        dirty = true;
      }
      continue;
    }
    const current = getByPath(parsed, f.path);
    if (current === undefined) continue;
    const target = isClean ? (f.placeholder !== undefined ? f.placeholder : "") : f.value;
    if (current !== target) {
      setByPath(parsed, f.path, target);
      dirty = true;
    }
  }
  if (!dirty) return content;
  const prefix = hadBom ? "\ufeff" : "";
  return prefix + JSON.stringify(parsed, null, 2) + "\n";
}

process.stdout.write(processContent(fs.readFileSync(0, "utf8")));