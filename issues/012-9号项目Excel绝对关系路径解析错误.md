# Excel 包内绝对关系路径解析错误

意图：读取符合结构的 Excel 时不因包内关系形式不同而报缺文件。
背景：resolveArchiveTarget 将 /xl/worksheets/sheet1.xml 直接与 xl 拼接，变成 xl/xl/worksheets/sheet1.xml。
边界：相对路径和绝对包内路径分别解析，不修改工作表字段规则。

- [x] 相对与绝对关系都定位到同一工作表。
- [x] 用真实生成的测试 XLSX 修改关系后读取验证。

2026-09-05：真实生成ZIP关系为 /xl/worksheets/sheet1.xml 的源表读取金额123.45成功；带绝对数据表关系的汇总模板完成写入、同店替换、独立读取金额200、岗位及行数验证。
