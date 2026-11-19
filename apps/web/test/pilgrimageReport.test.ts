import { describe, expect, it } from "vitest";
import { CeremonyRegistrationDto, CeremonyReportDto, GiftType } from "@tms/shared";
import { buildPilgrimageWorkbook } from "../src/utils/pilgrimageReport";

/** 一位參加者的報名紀錄；金額只掛在同一筆報名的第一位身上 */
const reg = (
  id: string,
  name: string,
  roomType: string | null,
  roomNumber: number | null,
  busNumber: number | null,
  amount: number,
  createdAt: string,
  receiptId: string | null = `r-${roomType}-${roomNumber}`,
): CeremonyRegistrationDto =>
  ({ id, participantName: name, roomType, roomNumber, busNumber, amount, createdAt, receiptId }) as CeremonyRegistrationDto;

const report = (overrides: Partial<CeremonyReportDto> = {}): CeremonyReportDto =>
  ({
    ceremony: {
      busCount: 2,
      roomTypes: [
        { name: "四人房", capacity: 4, fee: 3400, roomCount: 5, roomsBooked: 1 },
        { name: "三人房", capacity: 3, fee: 3800, roomCount: 5, roomsBooked: 1 },
        { name: "雙人房", capacity: 2, fee: 5400, roomCount: 5, roomsBooked: 0 },
      ],
    },
    totalAmount: 21200,
    registrationCount: 6,
    registrations: [
      reg("1", "龔忠欣", "四人房", 1, 1, 13600, "2026-11-18T00:28:00Z"),
      reg("2", "龔宇程", "四人房", 1, 1, 0, "2026-11-18T00:28:00Z"),
      reg("3", "龔泓儒", "四人房", 1, 1, 0, "2026-11-18T00:28:00Z"),
      reg("4", "蔡孟旻", "四人房", 1, 1, 0, "2026-11-18T00:28:00Z"),
      reg("5", "龔忠欣", "三人房", 1, 2, 7600, "2026-11-18T00:54:00Z"),
      reg("6", "", "三人房", 1, 2, 0, "2026-11-18T00:54:00Z"),
    ],
    donationTotal: 500,
    donations: [{ payerName: "善心", amount: 500, note: null, createdAt: "2026-11-18T01:00:00Z" }],
    expenseTotal: 1200,
    expenses: [{ category: "交通", amount: 1200, description: "油資", occurredAt: "2026-11-20" }],
    gifts: [
      { giverName: "陳太太", giftType: GiftType.FLOWERS, quantity: 2, createdAt: "2026-11-19T01:00:00Z" },
      { giverName: "", giftType: GiftType.WATER, quantity: 3, createdAt: "2026-11-19T02:00:00Z" },
      { giverName: "林老闆", giftType: GiftType.FLOWERS, quantity: 1, createdAt: "2026-11-19T03:00:00Z" },
    ],
    ...overrides,
  }) as CeremonyReportDto;

// 車次名單的功能保留（目前畫面不顯示），測試時明確打開，確認之後重新啟用時內容仍然正確
const sheet = (name: string, r = report()) => buildPilgrimageWorkbook(r, true).find((s) => s.name === name)!.rows;

describe("進香總表 Excel", () => {
  it("開啟車次時四個工作表依序是房型名單、車次名單、收入支出總表、收禮資訊", () => {
    expect(buildPilgrimageWorkbook(report(), true).map((s) => s.name)).toEqual(["房型名單", "車次名單", "收入支出總表", "收禮資訊"]);
  });

  it("目前進香不需要車次：預設只有房型名單、收入支出總表、收禮資訊三個工作表", () => {
    expect(buildPilgrimageWorkbook(report()).map((s) => s.name)).toEqual(["房型名單", "收入支出總表", "收禮資訊"]);
    expect(buildPilgrimageWorkbook(report(), false).map((s) => s.name)).toEqual(["房型名單", "收入支出總表", "收禮資訊"]);
  });

  it("房型名單：每個房型一塊，參加者橫向排開（欄數 = 每間人數），項次是第幾間；沒人訂的房型也留標題列", () => {
    expect(sheet("房型名單")).toEqual([
      ["四人房", "參加者", "參加者", "參加者", "參加者", "金額", "報名時間"],
      [1, "龔忠欣", "龔宇程", "龔泓儒", "蔡孟旻", 13600, "2026-11-18 08:28"],
      [],
      ["三人房", "參加者", "參加者", "參加者", "金額", "報名時間"],
      [1, "龔忠欣", "（未留姓名）", "", 7600, "2026-11-18 08:54"],
      [],
      ["雙人房", "參加者", "參加者", "金額", "報名時間"],
    ]);
  });

  it("房型名單：同房型多間依第幾間排序；沒有房型的舊資料放在「未分房型」，依收據分組", () => {
    const rows = sheet(
      "房型名單",
      report({
        registrations: [
          reg("a", "乙", "雙人房", 2, 1, 5400, "2026-11-18T02:00:00Z"),
          reg("b", "甲", "雙人房", 1, 1, 5400, "2026-11-18T01:00:00Z"),
          reg("c", "舊一", null, null, null, 800, "2026-11-01T01:00:00Z", "old-1"),
          reg("d", "舊二", null, null, null, 0, "2026-11-01T01:00:00Z", "old-1"),
          reg("e", "舊三", null, null, null, 800, "2026-11-02T01:00:00Z", "old-2"),
        ],
      }),
    );
    const doubleStart = rows.findIndex((r) => r[0] === "雙人房");
    expect(rows.slice(doubleStart + 1, doubleStart + 3).map((r) => [r[0], r[1]])).toEqual([
      [1, "甲"],
      [2, "乙"],
    ]);
    const legacyStart = rows.findIndex((r) => r[0] === "未分房型");
    expect(rows[legacyStart]).toEqual(["未分房型", "參加者", "參加者", "金額", "報名時間"]);
    expect(rows.slice(legacyStart + 1)).toEqual([
      [1, "舊一", "舊二", 800, "2026-11-01 09:00"],
      [2, "舊三", "", 800, "2026-11-02 09:00"],
    ]);
  });

  it("車次名單：每一車一塊，列出參加者、房型、第幾間，最後是人數；沒有車次的舊資料另列", () => {
    const rows = sheet(
      "車次名單",
      report({
        registrations: [
          reg("1", "甲", "四人房", 1, 1, 3400, "2026-11-18T00:28:00Z"),
          reg("2", "乙", "三人房", 1, 2, 3800, "2026-11-18T00:54:00Z"),
          reg("3", "舊", null, null, null, 800, "2026-11-01T01:00:00Z"),
        ],
      }),
    );
    expect(rows).toEqual([
      ["第1車", "參加者", "房型", "第幾間", "報名時間"],
      [1, "甲", "四人房", "第1間", "2026-11-18 08:28"],
      ["共", "1 人"],
      [],
      ["第2車", "參加者", "房型", "第幾間", "報名時間"],
      [1, "乙", "三人房", "第1間", "2026-11-18 08:54"],
      ["共", "1 人"],
      [],
      ["未指定車次", "參加者", "房型", "第幾間", "報名時間"],
      [1, "舊", "", "", "2026-11-01 09:00"],
      ["共", "1 人"],
    ]);
  });

  it("收入支出總表：報名費依房型列出間數與人數，加上活動捐款與支出，最後是合計與結餘", () => {
    expect(sheet("收入支出總表")).toEqual([
      ["類別", "項目", "收入", "支出"],
      ["報名費", "四人房（1 間、4 人）", 13600, ""],
      ["報名費", "三人房（1 間、2 人）", 7600, ""],
      ["活動捐款", "共 1 筆", 500, ""],
      ["支出", "交通 油資 2026-11-20", "", 1200],
      [],
      ["合計", "", 21700, 1200],
      ["結餘", "收入 − 支出", 20500, ""],
    ]);
  });

  it("收禮資訊：列出每份禮（沒留姓名的標示出來），最後依品項加總數量", () => {
    expect(sheet("收禮資訊")).toEqual([
      ["（送禮時指定屬於此活動的禮）"],
      ["送禮人", "品項", "數量", "收禮時間"],
      ["陳太太", "鮮花", 2, "2026-11-19 09:00"],
      ["（未留姓名）", "水", 3, "2026-11-19 10:00"],
      ["林老闆", "鮮花", 1, "2026-11-19 11:00"],
      [],
      ["品項合計", "品項", "數量"],
      ["", "鮮花", 3],
      ["", "水", 3],
    ]);
  });

  it("沒有任何報名與收禮：各表不會出錯，顯示沒有資料", () => {
    const empty = report({
      ceremony: { busCount: 0, roomTypes: [] } as never,
      registrations: [],
      totalAmount: 0,
      donations: [],
      donationTotal: 0,
      expenses: [],
      expenseTotal: 0,
      gifts: [],
    });
    expect(sheet("房型名單", empty)).toEqual([["尚無報名資料"]]);
    expect(sheet("車次名單", empty)).toEqual([["尚無車次資料"]]);
    expect(sheet("收禮資訊", empty)).toEqual([
      ["（送禮時指定屬於此活動的禮）"],
      ["送禮人", "品項", "數量", "收禮時間"],
      ["（沒有登記為此活動的收禮紀錄）"],
    ]);
  });
});
