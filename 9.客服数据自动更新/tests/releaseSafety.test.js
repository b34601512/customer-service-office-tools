const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const fromApp = file => require(path.join(root, file));
const dependency = name => require(require.resolve(name, { paths: [root] }));
const XLSX = dependency("xlsx");
const JSZip = dependency("jszip");
const { cleanOldSourceFiles } = fromApp("src/summary/configuredWorkflowParts/summaryRunReset.js");
const { resolveArchiveTarget, resolveWorksheetArchivePath } = fromApp("src/summaryData/xlsxWorkbookEngine.js");
const { createDefaultProjectConfig } = fromApp("src/config/projectConfigDefaults.js");
const { resolvePlatformStoreConfig } = fromApp("src/config/projectConfigServiceParts/projectConfigStoreResolver.js");
const { spawnManagedChrome } = fromApp("src/engine/chromeSessionParts/chromeLauncher.js");
const { readSummarySource } = fromApp("src/summaryData/summaryDataSourceReader.js");
const { writeSummaryData } = fromApp("src/summaryData/summaryDataWriter.js");
const { requiredHeaders } = fromApp("src/summaryData/summaryDataDetailSchema.js");
const { readDataDetailWorkbook } = fromApp("src/kdocsSync/dataDetailWorkbookReader.js");

async function main() {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "customer-release-safety-"));
  const downloads = path.join(testRoot, "下载目录");
  fs.mkdirSync(downloads);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const files = {};
  for (const name of ["registered", "unrelated", "workbook", "today", "outside"]) {
    files[name] = path.join(name === "outside" ? testRoot : downloads, `${name}.xlsx`);
    fs.writeFileSync(files[name], name);
    fs.utimesSync(files[name], name === "today" ? today : yesterday, name === "today" ? today : yesterday);
  }
  const cleaned = cleanOldSourceFiles(downloads, today, {
    history: { downloads: ["registered", "workbook", "today", "outside"].map(name => ({ filePath: files[name] })) },
    workbookPath: files.workbook
  });
  assert.equal(cleaned.removedCount, 1);
  assert.equal(fs.readFileSync(cleaned.backupPaths[0], "utf8"), "registered");
  for (const name of ["unrelated", "workbook", "today", "outside"]) assert.equal(fs.readFileSync(files[name], "utf8"), name);

  const snapshot = createDefaultProjectConfig();
  snapshot.tmall.stores[0].key = "snapshot-only";
  snapshot.tmall.stores[0].username = "snapshot-account";
  const resolved = resolvePlatformStoreConfig("tmall", "snapshot-only", "performance", snapshot);
  assert.equal(resolved.activeStore.username, "snapshot-account");
  resolved.activeStore.username = "changed";
  assert.equal(snapshot.tmall.stores[0].username, "snapshot-account");

  await assert.rejects(spawnManagedChrome("missing.exe", [], () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  }), /浏览器启动失败.*ENOENT/);
  const child = new EventEmitter();
  const launched = spawnManagedChrome("browser.exe", [], () => {
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  assert.equal(await launched, child);
  const { releaseDebugPort } = fromApp("src/engine/chromeSessionParts/chromePortGuard.js");
  const killedPids = [];
  assert.equal(await releaseDebugPort(9333, "测试", {
    isLocalPortOpen: async () => true,
    findDebugPidsOnPort: async () => [111, 222],
    findProcessIdsByCommandLine: async () => [222],
    killProcessTree: async pid => { killedPids.push(pid); return true; },
    waitForChromeDebugPortClosed: async () => true,
    logFn() {}, logErrorFn() {}
  }), true);
  assert.deepEqual(killedPids, [222]);
  const { closeManagedChromeWithDependencies } = fromApp("src/engine/chromeSessionParts/chromeCloser.js");
  await closeManagedChromeWithDependencies({
    readManagedPid: () => 111,
    findProcessIdsByCommandLine: async () => [222],
    closeProcessMainWindow: async () => assert.fail("不得关闭其他进程的主窗口"),
    killProcessTree: async () => assert.fail("不得结束其他进程"),
    waitForChromeDebugPortClosed: async () => true,
    clearManagedPid() {}, clearManagedChromeSession() {}, logFn() {}, logErrorFn() {}
  });

  assert.equal(resolveArchiveTarget("xl", "worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
  assert.equal(resolveArchiveTarget("xl", "/xl/worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
  const sourceWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(sourceWorkbook, XLSX.utils.aoa_to_sheet([["客服", "金额"], ["测试账号", 123.45]]), "源数据");
  const archive = await JSZip.loadAsync(XLSX.write(sourceWorkbook, { type: "buffer", bookType: "xlsx", bookSST: true }));
  const relationships = await archive.file("xl/_rels/workbook.xml.rels").async("string");
  archive.file("xl/_rels/workbook.xml.rels", relationships.replace(/Target="(?:\/xl\/)?worksheets\//g, 'Target="/xl/worksheets/'));
  assert.equal((await resolveWorksheetArchivePath(archive, "first_sheet", "")).worksheetPath, "xl/worksheets/sheet1.xml");
  const sourcePath = path.join(testRoot, "绝对关系源表.xlsx");
  fs.writeFileSync(sourcePath, await archive.generateAsync({ type: "nodebuffer" }));
  const sourceResult = await readSummarySource({
    sourceFilePath: sourcePath,
    reportProfile: { sourceSheetMode: "first_sheet", sourceAliasFieldLabel: "客服", metricMappings: [{ key: "amount", sourceFieldLabel: "金额" }] },
    personMappings: [{ summaryName: "测试客服", sourceNames: ["测试账号"] }]
  });
  assert.equal(sourceResult.rows[0].metrics.amount, 123.45);

  // 合成含数据表定义的汇总模板，真实执行写入、同店替换和备份。
  const summary = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(summary, XLSX.utils.aoa_to_sheet([["测试模板"], [], [], requiredHeaders]), "数据明细");
  const summaryArchive = await JSZip.loadAsync(XLSX.write(summary, { type: "buffer", bookType: "xlsx", bookSST: true }));
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  summaryArchive.file("xl/worksheets/_rels/sheet1.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="/xl/tables/table1.xml"/></Relationships>');
  summaryArchive.file("xl/tables/table1.xml", `<table xmlns="${ns}" id="1" name="DetailTable" displayName="DetailTable" ref="A4:X4"><autoFilter ref="A4:X4"/><tableColumns count="24">${requiredHeaders.map((name, index) => `<tableColumn id="${index + 1}" name="${name}"/>`).join("")}</tableColumns></table>`);
  const sheetXml = await summaryArchive.file("xl/worksheets/sheet1.xml").async("string");
  summaryArchive.file("xl/worksheets/sheet1.xml", sheetXml.replace("</worksheet>", '<tableParts count="1"><tablePart r:id="rIdTable"/></tableParts></worksheet>'));
  const contentTypes = await summaryArchive.file("[Content_Types].xml").async("string");
  summaryArchive.file("[Content_Types].xml", contentTypes.replace("</Types>", '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>'));
  const styles = await summaryArchive.file("xl/styles.xml").async("string");
  summaryArchive.file("xl/styles.xml", styles.replace(/<cellXfs[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="15">${'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'.repeat(15)}</cellXfs>`));
  const summaryPath = path.join(testRoot, "汇总.xlsx");
  fs.writeFileSync(summaryPath, await summaryArchive.generateAsync({ type: "nodebuffer" }));
  const row = { periodStart: "2026-08-01", periodEnd: "2026-08-31", periodGranularity: "统计期间", platform: "天猫", storeKey: "test", storeName: "测试店", personName: "测试客服", salesAmount: 123.45, inquiryCount: 10, orderCount: 2, responseWeight: 10, responseTotalSeconds: 120, sourceFiles: "测试源表.xlsx", importedAt: today.toISOString() };
  await writeSummaryData({ workbookPath: summaryPath, rows: [row], personRoles: { 测试客服: "售前" } });
  const replaced = await writeSummaryData({ workbookPath: summaryPath, rows: [{ ...row, salesAmount: 200 }], personRoles: { 测试客服: "售前" } });
  assert.equal(replaced.removedCount, 1);
  const readBack = await readDataDetailWorkbook(summaryPath);
  assert.equal(readBack.dataRowCount, 1);
  assert.equal(readBack.dataDetailRows[1][8], 200);
  assert.equal(readBack.dataDetailRows[1][7], "售前");
  assert.equal(XLSX.readFile(summaryPath).Sheets["数据明细"].I5.v, 200);
  console.log("PASS: 已登记源表备份及误删防护、配置快照、浏览器启动失败和关闭归属、真实Excel读取/替换/回读");
  console.log(`测试资料保留：${testRoot}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
