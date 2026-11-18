import type { Borders, Workbook } from "exceljs";
import { LanternSlotDto, LanternWallDto } from "@tms/shared";

/**
 * 燈位表 Excel：依燈牆實際位置排列（第 1 排在最上面、第 1 格在最左邊，跟畫面上的燈位圖一致）。
 * 每個燈位佔上下兩格：上面是燈位編號、下面是點燈人姓名，兩格外圍用粗黑框框起來；
 * 每排之間空一列，排版整齊、印出來也好辨識。沒有燈位的位置留白不畫框。
 */

/** 排版結果：每一排有哪些燈位、落在第幾欄（欄位從 1 開始，最左邊有燈位的那一格是第 1 欄） */
export interface WallLayout {
  columnCount: number;
  rows: { gridRow: number; cells: { column: number; code: string; name: string }[] }[];
}

export function layoutWall(slots: LanternSlotDto[]): WallLayout {
  if (slots.length === 0) return { columnCount: 0, rows: [] };
  const minColumn = Math.min(...slots.map((s) => s.gridColumn));
  const maxColumn = Math.max(...slots.map((s) => s.gridColumn));
  const gridRows = Array.from(new Set(slots.map((s) => s.gridRow))).sort((a, b) => a - b);
  return {
    columnCount: maxColumn - minColumn + 1,
    rows: gridRows.map((gridRow) => ({
      gridRow,
      cells: slots
        .filter((s) => s.gridRow === gridRow)
        .sort((a, b) => a.gridColumn - b.gridColumn)
        .map((s) => ({ column: s.gridColumn - minColumn + 1, code: s.code, name: s.claim?.memberName ?? "" })),
    })),
  };
}

const THICK = { style: "medium" as const, color: { argb: "FF000000" } };
const THIN = { style: "thin" as const, color: { argb: "FF000000" } };
/** 編號格：上、左、右粗框，跟姓名格之間細線 */
const CODE_BORDER: Partial<Borders> = { top: THICK, left: THICK, right: THICK, bottom: THIN };
/** 姓名格：下、左、右粗框 */
const NAME_BORDER: Partial<Borders> = { top: THIN, left: THICK, right: THICK, bottom: THICK };
const FONT = { name: "Microsoft JhengHei", size: 12 };

/** 第一列標題、第二列空白，燈位從第三列開始 */
const FIRST_SLOT_ROW = 3;

export function excelRowsOf(layoutRowIndex: number): { codeRow: number; nameRow: number } {
  // 每排佔 3 列：編號、姓名、空白
  const codeRow = FIRST_SLOT_ROW + layoutRowIndex * 3;
  return { codeRow, nameRow: codeRow + 1 };
}

/** 把燈位表寫進活頁簿（exceljs 由呼叫端傳入，方便測試時直接檢查內容） */
export function fillLanternWallWorkbook(workbook: Workbook, wall: LanternWallDto, slots: LanternSlotDto[]) {
  const layout = layoutWall(slots);
  const sheet = workbook.addWorksheet((wall.name || "燈位表").replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "燈位表", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  const columnCount = Math.max(layout.columnCount, 1);
  sheet.columns = Array.from({ length: columnCount }, () => ({ width: 13 }));

  const title = sheet.getCell(1, 1);
  title.value = `${wall.name}（${wall.year} 年）燈位表　已點 ${slots.filter((s) => s.claim).length} / ${slots.length} 盞`;
  title.font = { ...FONT, size: 14, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  if (columnCount > 1) sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getRow(1).height = 26;

  layout.rows.forEach((row, index) => {
    const { codeRow, nameRow } = excelRowsOf(index);
    sheet.getRow(codeRow).height = 22;
    sheet.getRow(nameRow).height = 24;
    sheet.getRow(nameRow + 1).height = 10; // 排與排之間的空白列
    for (const cell of row.cells) {
      const code = sheet.getCell(codeRow, cell.column);
      code.value = cell.code;
      code.font = FONT;
      code.alignment = { horizontal: "center", vertical: "middle" };
      code.border = CODE_BORDER;

      const name = sheet.getCell(nameRow, cell.column);
      name.value = cell.name;
      name.font = FONT;
      name.alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
      name.border = NAME_BORDER;
    }
  });
  return sheet;
}

/** 產生燈位表並下載：exceljs 體積較大，只在按下匯出時才載入 */
export async function exportLanternWallExcel(wall: LanternWallDto, slots: LanternSlotDto[]) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  fillLanternWallWorkbook(workbook, wall, slots);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `燈位表_${wall.name}_${wall.year}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
