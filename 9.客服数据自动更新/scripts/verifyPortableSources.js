// 全量检查包内源码语法及字面量 require 解析；不执行业务模块。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire, isBuiltin } = require("node:module");
const root = path.resolve(process.argv[2]);
const packageRoot = path.dirname(root);
let fileCount = 0;
let importCount = 0;
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(filename);
    else if (entry.isFile() && filename.endsWith(".js")) {
      const source = fs.readFileSync(filename, "utf8");
      new vm.Script(source, { filename });
      const resolve = createRequire(filename).resolve;
      for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
        const specifier = match[1];
        if (isBuiltin(specifier)) continue;
        const resolved = resolve(specifier);
        const relative = path.relative(packageRoot, resolved);
        if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error(`包外依赖：${filename} -> ${resolved}`);
        importCount += 1;
      }
      fileCount += 1;
    }
  }
}
visit(path.join(root, "src"));
visit(path.join(packageRoot, "共享CLI"));
console.log(`PASS: ${fileCount} 个源码文件语法、${importCount} 处模块引用均在包内解析`);
