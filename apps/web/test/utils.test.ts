import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { LanternSlotDto, LanternSlotStatus } from "@tms/shared";
import { lanternCellWidth } from "../src/utils/lanternCell";
import { joinLanternType, splitLanternType } from "../src/utils/lanternType";
import { parseMemberImportFile } from "../src/utils/memberImport";

describe("點燈內容的合併與還原（lanternType）", () => {
  it("split：以「、」拆開；空值回傳空陣列；多餘的分隔符號不會產生空項目", () => {
    expect(splitLanternType("光明燈、平安燈")).toEqual(["光明燈", "平安燈"]);
    expect(splitLanternType("光明燈")).toEqual(["光明燈"]);
    expect(splitLanternType("")).toEqual([]);
    expect(splitLanternType(null)).toEqual([]);
    expect(splitLanternType(undefined)).toEqual([]);
    expect(splitLanternType("光明燈、、平安燈、")).toEqual(["光明燈", "平安燈"]);
  });

  it("join：以「、」合併；沒選任何項目回傳 null（存進資料庫是空值，不是空字串）", () => {
    expect(joinLanternType(["光明燈", "平安燈"])).toBe("光明燈、平安燈");
    expect(joinLanternType([])).toBeNull();
    expect(joinLanternType(undefined)).toBeNull();
  });

  it("拆開再合併會還原成原本的字串", () => {
    expect(joinLanternType(splitLanternType("光明燈、財利燈、文昌燈"))).toBe("光明燈、財利燈、文昌燈");
  });
});

describe("燈位格寬度（lanternCellWidth）", () => {
  const slot = (code: string, memberName?: string): LanternSlotDto =>
    ({
      id: "s",
      wallId: "w",
      code,
      row: 1,
      column: 1,
      gridRow: 1,
      gridColumn: 1,
      status: memberName ? LanternSlotStatus.CLAIMED : LanternSlotStatus.EMPTY,
      claim: memberName
        ? { id: "c", memberId: null, memberName, wishText: null, petitionText: null, lanternType: null, amount: 0 }
        : undefined,
    }) as LanternSlotDto;

  it("短代碼用最小寬度 90", () => {
    expect(lanternCellWidth(slot("A-01"))).toBe(90);
  });

  it("全形字比半形字寬：很長的中文代碼會把格子撐開", () => {
    // 6 個全形字 × 16px = 96，加上 28 的內距
    expect(lanternCellWidth(slot("右牆第一排上"))).toBe(124);
  });

  it("姓名比代碼寬時以姓名為準", () => {
    // 9 個全形字 × 12px = 108，加上 28
    expect(lanternCellWidth(slot("A-01", "財團法人某某基金會"))).toBe(136);
  });
});

describe("信徒匯入檔解析（parseMemberImportFile）", () => {
  const toFile = (rows: unknown[][]): File => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "信徒資料");
    const data = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    // jsdom 的 File 沒有 arrayBuffer()，補上測試需要的最小介面
    return { arrayBuffer: async () => data } as unknown as File;
  };

  it("只有標題列、沒有資料：回傳空陣列", async () => {
    expect(await parseMemberImportFile(toFile([["戶籍地址", "姓名"]]))).toEqual([]);
  });

  it("標準範本欄位：每個欄位對到正確的位置，空白欄位是 undefined", async () => {
    const rows = await parseMemberImportFile(
      toFile([
        ["戶籍地址", "戶電話", "姓名", "電話", "信徒地址", "性別", "生日(西元)", "標籤"],
        ["嘉義縣中埔鄉1號", "05-2361234", " 王小明 ", "0912345678", "", "男", "1990-01-01", "一般信徒"],
      ]),
    );
    expect(rows).toEqual([
      {
        householdKey: undefined,
        householdAddress: "嘉義縣中埔鄉1號",
        householdPhone: "05-2361234",
        name: "王小明",
        phone: "0912345678",
        address: undefined,
        gender: "男",
        birthDateSolar: "1990-01-01",
        tags: "一般信徒",
      },
    ]);
  });

  it("舊式資料表：標題有別名與空白、生日拆成民國年／月／日三欄、郵遞區號併進地址", async () => {
    const [row] = await parseMemberImportFile(
      toFile([
        ["戶號", "郵遞區號", "地 址", "姓名name", "年", "月", "日", "性別sex"],
        ["H001", "606", "嘉義縣中埔鄉2號", "李大華", 79, 5, 15, "女"],
      ]),
    );
    expect(row).toMatchObject({
      householdKey: "H001",
      householdAddress: "606 嘉義縣中埔鄉2號",
      name: "李大華",
      gender: "女",
      birthDateSolar: "1990-05-15",
    });
  });

  it("年月日缺任何一欄就不組生日；單一生日欄位有值時優先採用", async () => {
    const rows = await parseMemberImportFile(
      toFile([
        ["姓名", "生日", "年", "月", "日"],
        ["缺日", "", 79, 5, ""],
        ["兩種都有", "2001-02-03", 79, 5, 15],
      ]),
    );
    expect(rows[0].birthDateSolar).toBeUndefined();
    expect(rows[1].birthDateSolar).toBe("2001-02-03");
  });

  it("看不懂的欄位會被忽略，不影響其他欄位", async () => {
    const [row] = await parseMemberImportFile(
      toFile([
        ["姓名", "備註欄"],
        ["王小明", "隨便寫"],
      ]),
    );
    expect(row.name).toBe("王小明");
    expect(Object.keys(row)).not.toContain("備註欄");
  });
});
