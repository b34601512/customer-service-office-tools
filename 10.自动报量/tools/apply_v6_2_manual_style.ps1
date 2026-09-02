$ErrorActionPreference = 'Stop'

$ManualPath = 'D:\桌面\办公软件\10.自动报量\2026年【报量】表.xlsx'
$TargetPath = 'D:\桌面\办公软件\10.自动报量\html导入工具\2026年智能报量-v6.2.xlsx'
$BackupDirectory = 'D:\备份文件夹\自动报量\v6.2样式复用'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupPath = Join-Path $BackupDirectory "2026年智能报量-v6.2-样式复用前-$Timestamp.xlsx"
$DateShiftColumnWidth = 9.0

function Write-StyleLog {
  param(
    [string]$FileLine,
    [string]$MainAction,
    [string]$ModuleName,
    [string]$SubAction
  )
  # 统一输出关键动作日志，方便对照脚本执行进度。
  Write-Output ("[{0}][{1}][主线:{2}][{3}][{4}]" -f (Get-Date -Format 'HH:mm:ss'), $FileLine, $MainAction, $ModuleName, $SubAction)
}

function Get-ExcelColumnName {
  param([int]$ColumnNumber)
  # 把列号转成Excel列名，避免手写列名时算错。
  $name = ''
  $current = $ColumnNumber
  while ($current -gt 0) {
    $remainder = ($current - 1) % 26
    $name = [char][int](65 + $remainder) + $name
    $current = [math]::Floor(($current - 1) / 26)
  }
  return $name
}

function Get-MonthDayCount {
  param([int]$Month)
  # 只处理2026年月份天数，确保每个月日期列和模板结构一致。
  $dayCounts = @(0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
  if ($Month -lt 1 -or $Month -gt 12) { throw "非法月份：$Month" }
  return $dayCounts[$Month]
}

function Copy-ColumnFormat {
  param(
    [object]$SourceSheet,
    [object]$TargetSheet,
    [int]$SourceColumn,
    [int]$TargetColumn,
    [int]$LastRow
  )
  # 只复制单列格式，不复制值和公式，避免破坏智能模板数据结构。
  $sourceColumnName = Get-ExcelColumnName $SourceColumn
  $targetColumnName = Get-ExcelColumnName $TargetColumn
  $SourceSheet.Range("${sourceColumnName}1:${sourceColumnName}${LastRow}").Copy() | Out-Null
  $TargetSheet.Range("${targetColumnName}1:${targetColumnName}${LastRow}").PasteSpecial(-4122) | Out-Null
}

function Merge-DayHeaderPairs {
  param(
    [object]$TargetSheet,
    [int]$RowNumber,
    [int]$DayCount
  )
  # 复用样式后再次确认日期标题合并，避免 D:BK 区域退回散列。
  for ($day = 1; $day -le $DayCount; $day++) {
    $targetDayColumn = 4 + (($day - 1) * 2)
    $targetNightColumn = $targetDayColumn + 1
    $dayColumnName = Get-ExcelColumnName $targetDayColumn
    $nightColumnName = Get-ExcelColumnName $targetNightColumn
    $range = $TargetSheet.Range("${dayColumnName}${RowNumber}:${nightColumnName}${RowNumber}")
    if (-not [bool]$range.MergeCells) {
      $range.Merge() | Out-Null
    }
  }
}

function Unmerge-DayHeaderPairs {
  param(
    [object]$TargetSheet,
    [int]$RowNumber,
    [int]$DayCount
  )
  # 粘贴整列格式前必须临时取消合并，否则 Excel 会拒绝粘贴到合并区域。
  for ($day = 1; $day -le $DayCount; $day++) {
    $targetDayColumn = 4 + (($day - 1) * 2)
    $targetNightColumn = $targetDayColumn + 1
    $dayColumnName = Get-ExcelColumnName $targetDayColumn
    $nightColumnName = Get-ExcelColumnName $targetNightColumn
    $range = $TargetSheet.Range("${dayColumnName}${RowNumber}:${nightColumnName}${RowNumber}")
    if ([bool]$range.MergeCells) {
      $range.UnMerge() | Out-Null
    }
  }
}

function Get-StoreHeaderRows {
  param(
    [object]$TargetSheet,
    [int]$LastRow
  )
  # 店铺标题行固定在产品标题行上方两行，用目标表自身结构识别比硬编码行号更稳。
  $rows = New-Object System.Collections.Generic.List[int]
  for ($row = 3; $row -le ($LastRow - 2); $row++) {
    $headerText = [string]$TargetSheet.Cells.Item($row + 2, 3).Text
    $storeText = [string]$TargetSheet.Cells.Item($row, 3).Text
    if ($headerText -eq '产品' -and $storeText.Trim()) {
      $rows.Add($row)
    }
  }
  return $rows
}

function Get-SummaryRows {
  param(
    [object]$TargetSheet,
    [int]$LastRow
  )
  # 本店汇总行固定在产品标题行上一行，用于统一修正公式数字格式。
  $rows = New-Object System.Collections.Generic.List[int]
  for ($row = 2; $row -le ($LastRow - 1); $row++) {
    $headerText = [string]$TargetSheet.Cells.Item($row + 1, 3).Text
    if ($headerText -eq '产品') {
      $rows.Add($row)
    }
  }
  return $rows
}

function Reset-SummaryFormulaFormats {
  param(
    [object]$TargetSheet,
    [int]$DayCount,
    [object]$SummaryRows
  )
  # 日期列复制样式后，公式格可能继承日期格式，必须改回普通数字。
  for ($day = 1; $day -le $DayCount; $day++) {
    $targetDayColumn = 4 + (($day - 1) * 2)
    $targetNightColumn = $targetDayColumn + 1
    $TargetSheet.Cells.Item(3, $targetDayColumn).NumberFormat = 'General'
    foreach ($summaryRow in $SummaryRows) {
      $TargetSheet.Cells.Item($summaryRow, $targetNightColumn).NumberFormat = 'General'
    }
  }
}

function Apply-DateColumnWidths {
  param(
    [object]$TargetSheet,
    [int]$DayCount
  )
  # D:BK 日期区统一白班/夜班列宽，避免同一班次模板出现两套宽度。
  for ($day = 1; $day -le $DayCount; $day++) {
    $targetDayColumn = 4 + (($day - 1) * 2)
    $targetNightColumn = $targetDayColumn + 1
    $TargetSheet.Columns.Item($targetDayColumn).ColumnWidth = $DateShiftColumnWidth
    $TargetSheet.Columns.Item($targetNightColumn).ColumnWidth = $DateShiftColumnWidth
  }
}

Write-StyleLog 'apply_v6_2_manual_style.ps1:68' '样式复用' '备份' '创建备份目录'
New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null
Copy-Item -LiteralPath $TargetPath -Destination $BackupPath -Force
Write-StyleLog 'apply_v6_2_manual_style.ps1:71' '样式复用' '备份' "已备份到 $BackupPath"

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$manualWorkbook = $null
$targetWorkbook = $null

try {
  Write-StyleLog 'apply_v6_2_manual_style.ps1:81' '样式复用' 'Excel' '打开手工表和v6.2模板'
  $manualWorkbook = $excel.Workbooks.Open($ManualPath, $null, $true)
  $targetWorkbook = $excel.Workbooks.Open($TargetPath, $null, $false)
  $manualSheet = $manualWorkbook.Worksheets.Item('2026-6')
  $lastRow = 503

  foreach ($targetSheet in $targetWorkbook.Worksheets) {
    $sheetName = [string]$targetSheet.Name
    if ($sheetName -notmatch '^2026-(\d{1,2})\s*$') {
      continue
    }
    $month = [int]$Matches[1]
    $dayCount = Get-MonthDayCount $month
    Write-StyleLog 'apply_v6_2_manual_style.ps1:95' '样式复用' $sheetName '复制基础列格式'

    $manualSheet.Range("C1:E$lastRow").Copy() | Out-Null
    $targetSheet.Range("A1:C$lastRow").PasteSpecial(-4122) | Out-Null

    for ($row = 1; $row -le $lastRow; $row++) {
      $targetSheet.Rows.Item($row).RowHeight = $manualSheet.Rows.Item($row).RowHeight
    }
    $targetSheet.Columns.Item(1).ColumnWidth = $manualSheet.Columns.Item(3).ColumnWidth
    $targetSheet.Columns.Item(2).ColumnWidth = $manualSheet.Columns.Item(4).ColumnWidth
    $targetSheet.Columns.Item(3).ColumnWidth = $manualSheet.Columns.Item(5).ColumnWidth

    $storeHeaderRows = Get-StoreHeaderRows $targetSheet $lastRow
    $summaryRows = Get-SummaryRows $targetSheet $lastRow
    Unmerge-DayHeaderPairs $targetSheet 2 $dayCount
    Unmerge-DayHeaderPairs $targetSheet 3 $dayCount
    foreach ($storeHeaderRow in $storeHeaderRows) {
      Unmerge-DayHeaderPairs $targetSheet $storeHeaderRow $dayCount
    }

    Write-StyleLog 'apply_v6_2_manual_style.ps1:108' '样式复用' $sheetName '复制日期列格式'
    for ($day = 1; $day -le $dayCount; $day++) {
      $sourceDayColumn = 6 + (($day - 1) * 4)
      $sourceNightColumn = $sourceDayColumn + 2
      $targetDayColumn = 4 + (($day - 1) * 2)
      $targetNightColumn = $targetDayColumn + 1

      Copy-ColumnFormat $manualSheet $targetSheet $sourceDayColumn $targetDayColumn $lastRow
      Copy-ColumnFormat $manualSheet $targetSheet $sourceNightColumn $targetNightColumn $lastRow
      $targetSheet.Columns.Item($targetDayColumn).ColumnWidth = $manualSheet.Columns.Item($sourceDayColumn).ColumnWidth
      $targetSheet.Columns.Item($targetNightColumn).ColumnWidth = $manualSheet.Columns.Item($sourceNightColumn).ColumnWidth
    }

    Merge-DayHeaderPairs $targetSheet 2 $dayCount
    Merge-DayHeaderPairs $targetSheet 3 $dayCount
    foreach ($storeHeaderRow in $storeHeaderRows) {
      Merge-DayHeaderPairs $targetSheet $storeHeaderRow $dayCount
    }
    Reset-SummaryFormulaFormats $targetSheet $dayCount $summaryRows
    Apply-DateColumnWidths $targetSheet $dayCount

    # 程序日期定位行必须保留隐藏，样式复用不能让用户误删。
    $targetSheet.Rows.Item(1).Hidden = $true
    $targetSheet.Rows.Item(1).RowHeight = 0
  }

  $excel.CutCopyMode = $false
  Write-StyleLog 'apply_v6_2_manual_style.ps1:128' '样式复用' 'Excel' '保存v6.2模板'
  $targetWorkbook.Save()
}
finally {
  if ($targetWorkbook -ne $null) { $targetWorkbook.Close($false) }
  if ($manualWorkbook -ne $null) { $manualWorkbook.Close($false) }
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}

Write-StyleLog 'apply_v6_2_manual_style.ps1:138' '样式复用' '完成' '手工表样式已应用到v6.2模板'
