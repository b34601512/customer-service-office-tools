import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "D:/桌面/办公软件/12.店铺指标数据自动更新/outputs/019fbb96-c39c-7ec1-899b-038594c1381a/店铺指标数据源.xlsx";
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 8000,
  tableMaxRows: 5,
  tableMaxCols: 8,
  tableMaxCellChars: 80
});
console.log("SUMMARY");
console.log(summary.ndjson);
const sheet = workbook.worksheets.getItem("数据源");
const values = sheet.getRange("A215:N255").values;
console.log("ROWS");
for (let index = 0; index < values.length; index += 1) {
  const row = values[index];
  if (row.some((value) => value !== null && value !== "")) {
    console.log(JSON.stringify({ row: index + 215, values: row }));
  }
}
