import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { LanternSlotDto, LanternSlotStatus, LanternWallDto } from "@tms/shared";
import { excelRowsOf, fillLanternWallWorkbook, layoutWall } from "../src/utils/lanternWallExcel";

const wall = { id: "w1", name: "光明燈右牆", year: 2026 } as LanternWallDto;

const slot = (code: string, gridRow: number, gridColumn: number, name?: string): LanternSlotDto =>
  ({
    id: code,
    wallId: "w1",
    code,
    row: gridRow,
    column: gridColumn,
    gridRow,
    gridColumn,
    status: name ? LanternSlotStatus.CLAIMED : LanternSlotStatus.EMPTY,
    claim: name ? { id: `c-${code}`, memberId: null, memberName: name, wishText: null, petitionText: null, lanternType: "光明燈", amount: 600 } : undefined,
  }) as LanternSlotDto;

const slots = [
  slot("A1-01", 1, 1, "龔忠欣"),
  slot("A1-02", 1, 2, "龔宇程"),
  slot("A1-03", 1, 3, "龔泓儒"),
  slot("A2-01", 2, 1),
  slot("A2-03", 2, 3, "蔡孟旻"), // 第 2 排中間沒有燈位
];

const build = (list = slots) => {
  const workbook = new ExcelJS.Workbook();
  return fillLanternWallWorkbook(workbook, wall, list);
};

describe("燈位表 Excel", () => {
  it("layoutWall：依實際位置排列，第 1 排在最上面；欄位從最左邊有燈位的那格算第 1 欄", () => {
    const layout = layoutWall([slot("B-02", 3, 5, "乙"), slot("B-01", 3, 4), slot("A-01", 2, 6, "甲")]);
    expect(layout.columnCount).toBe(3);
    expect(layout.rows).toEqual([
      { gridRow: 2, cells: [{ column: 3, code: "A-01", name: "甲" }] },
      {
        gridRow: 3,
        cells: [
          { column: 1, code: "B-01", name: "" },
          { column: 2, code: "B-02", name: "乙" },
        ],
      },
    ]);
    expect(layoutWall([])).toEqual({ columnCount: 0, rows: [] });
  });

  it("每排三列：編號、姓名、空白；第一列是標題（燈牆名稱、年度、點燈進度），第二列空白", () => {
    const sheet = build();
    expect(sheet.name).toBe("光明燈右牆");
    expect(sheet.getCell("A1").value).toBe("光明燈右牆（2026 年）燈位表　已點 4 / 5 盞");
    expect(sheet.getCell("A1").isMerged).toBe(true);
    expect(excelRowsOf(0)).toEqual({ codeRow: 3, nameRow: 4 });
    expect(excelRowsOf(1)).toEqual({ codeRow: 6, nameRow: 7 });

    const values = (row: number) => [1, 2, 3].map((c) => sheet.getCell(row, c).value ?? null);
    expect(values(2)).toEqual([null, null, null]);
    expect(values(3)).toEqual(["A1-01", "A1-02", "A1-03"]);
    expect(values(4)).toEqual(["龔忠欣", "龔宇程", "龔泓儒"]);
    expect(values(5)).toEqual([null, null, null]); // 排與排之間空一列
    expect(values(6)).toEqual(["A2-01", null, "A2-03"]);
    expect(values(7)).toEqual(["", null, "蔡孟旻"]); // 還沒點燈的燈位：姓名空白但框還在
  });

  it("每個燈位的編號與姓名兩格外圍是粗黑框，兩格之間細線；沒有燈位的格子不畫框", () => {
    const sheet = build();
    const code = sheet.getCell(3, 1).border;
    const name = sheet.getCell(4, 1).border;
    expect([code.top?.style, code.left?.style, code.right?.style, code.bottom?.style]).toEqual(["medium", "medium", "medium", "thin"]);
    expect([name.top?.style, name.left?.style, name.right?.style, name.bottom?.style]).toEqual(["thin", "medium", "medium", "medium"]);
    expect(code.top?.color?.argb).toBe("FF000000");
    // 第 2 排中間（A2-02 不存在）沒有框
    expect(Object.keys(sheet.getCell(6, 2).border ?? {})).toEqual([]);
    expect(Object.keys(sheet.getCell(7, 2).border ?? {})).toEqual([]);
    // 空白列也不畫框
    expect(Object.keys(sheet.getCell(5, 1).border ?? {})).toEqual([]);
  });

  it("內容置中、欄寬一致；A4 橫向、縮放成一頁寬", () => {
    const sheet = build();
    expect(sheet.getCell(4, 2).alignment).toMatchObject({ horizontal: "center", vertical: "middle" });
    expect(sheet.columns.map((c) => c.width)).toEqual([13, 13, 13]);
    expect(sheet.pageSetup).toMatchObject({ paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
  });

  it("工作表名稱去掉 Excel 不允許的符號；只有一欄時標題不合併", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = fillLanternWallWorkbook(workbook, { ...wall, name: "右牆/第[1]面" }, [slot("A-01", 1, 1, "甲")]);
    expect(sheet.name).toBe("右牆第1面");
    expect(sheet.getCell("A1").isMerged).toBe(false);
  });

  it("寫出的檔案可以被讀回來，框線與文字都還在", async () => {
    const workbook = new ExcelJS.Workbook();
    fillLanternWallWorkbook(workbook, wall, slots);
    const buffer = await workbook.xlsx.writeBuffer();
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(buffer);
    const sheet = reread.getWorksheet("光明燈右牆")!;
    expect(sheet.getCell(4, 3).value).toBe("龔泓儒");
    expect(sheet.getCell(4, 3).border.bottom?.style).toBe("medium");
  });
});
