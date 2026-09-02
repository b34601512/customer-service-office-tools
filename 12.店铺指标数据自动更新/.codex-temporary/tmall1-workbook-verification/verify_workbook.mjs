import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = process.argv[2];
const outputDirectory = process.argv[3];
if (!workbookPath || !outputDirectory) {
  throw new Error("缺少工作簿路径或验证产出目录。");
}

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const overview = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 8000,
  tableMaxRows: 5,
  tableMaxCols: 18,
  tableMaxCellChars: 100
});
const dataSource = await workbook.inspect({
  kind: "region",
  sheetId: "数据源",
  range: "A1:R20",
  maxChars: 12000
});
const tmallDataSource = await workbook.inspect({
  kind: "region",
  sheetId: "数据源",
  range: "A120:R170",
  maxChars: 12000
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "店铺指标汇总表公式错误扫描"
});
await fs.mkdir(outputDirectory, { recursive: true });
const preview = await workbook.render({
  sheetName: "数据源",
  range: "A1:R20",
  scale: 1,
  format: "png"
});
await fs.writeFile(path.join(outputDirectory, "数据源验证.png"), new Uint8Array(await preview.arrayBuffer()));
const tmallPreview = await workbook.render({
  sheetName: "数据源",
  range: "A120:R170",
  scale: 1,
  format: "png"
});
await fs.writeFile(path.join(outputDirectory, "天猫数据验证.png"), new Uint8Array(await tmallPreview.arrayBuffer()));
const instructionsPreview = await workbook.render({
  sheetName: "使用说明",
  range: "A1:B8",
  scale: 1,
  format: "png"
});
await fs.writeFile(path.join(outputDirectory, "使用说明验证.png"), new Uint8Array(await instructionsPreview.arrayBuffer()));
console.log(JSON.stringify({
  overview: overview.ndjson,
  dataSource: dataSource.ndjson,
  tmallDataSource: tmallDataSource.ndjson,
  formulaErrors: formulaErrors.ndjson
}, null, 2));
