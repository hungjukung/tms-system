import { describe, expect, it } from "vitest";
import { CeremonyKind, CeremonyRegistrationDto, CeremonyReportDto, CeremonySession, GiftType } from "@tms/shared";
import {
  buildBusRosterHtml,
  buildParticipantRosterHtml,
  buildRoomRosterHtml,
  buildSettlementHtml,
  computeSettlement,
  escapeHtml,
} from "../src/utils/printReport";

const reg = (overrides: Partial<CeremonyRegistrationDto>): CeremonyRegistrationDto =>
  ({
    id: Math.random().toString(36).slice(2),
    participantName: "甲",
    roomType: null,
    roomNumber: null,
    busNumber: null,
    session: null,
    queueNumber: null,
    seatNumber: null,
    amount: 0,
    createdAt: "2026-11-18T00:00:00Z",
    receiptId: "r1",
    ...overrides,
  }) as CeremonyRegistrationDto;

const pilgrimageReport = (overrides: Partial<CeremonyReportDto> = {}): CeremonyReportDto =>
  ({
    ceremony: {
      name: "北港進香",
      date: "2026-12-01",
      kind: CeremonyKind.PILGRIMAGE,
      busCount: 2,
      roomTypes: [
        { name: "雙人房", capacity: 2, fee: 3000, roomCount: 5, roomsBooked: 1 },
        { name: "四人房", capacity: 4, fee: 2500, roomCount: 2, roomsBooked: 0 },
      ],
    },
    registrations: [
      reg({ participantName: "王小明", roomType: "雙人房", roomNumber: 1, busNumber: 1, amount: 6000, receiptId: "a" }),
      reg({ participantName: "王太太", roomType: "雙人房", roomNumber: 1, busNumber: 1, receiptId: "a" }),
      reg({ participantName: "李<大>華", roomType: "雙人房", roomNumber: 2, busNumber: 2, amount: 3000, receiptId: "b" }),
    ],
    totalAmount: 9000,
    registrationCount: 3,
    donations: [{ payerName: "善心", amount: 500, note: "添油香", createdAt: "2026-11-18T00:00:00Z" }],
    donationTotal: 500,
    expenses: [{ category: "交通", amount: 1200, description: "遊覽車", occurredAt: "2026-12-01" }],
    expenseTotal: 1200,
    gifts: [
      { giverName: "陳太太", giftType: GiftType.FLOWERS, quantity: 2, createdAt: "2026-11-18T00:00:00Z" },
      { giverName: "林老闆", giftType: GiftType.FLOWERS, quantity: 1, createdAt: "2026-11-18T00:00:00Z" },
    ],
    ...overrides,
  }) as CeremonyReportDto;

/** 把 HTML 轉成純文字比對，避免綁死排版標籤 */
const text = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // 表格儲存格之間補一個空白，文字才不會黏在一起
  doc.querySelectorAll("td, th").forEach((cell) => cell.append(" "));
  return doc.body.textContent?.replace(/\s+/g, " ") ?? "";
};
const sections = (html: string) => new DOMParser().parseFromString(html, "text/html").querySelectorAll("section.page");

describe("列印版報表", () => {
  it("escapeHtml：姓名裡的 < > & 引號都會轉義，不會被當成 HTML", () => {
    expect(escapeHtml(`<script>alert("x")</script> & '`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;");
    const html = buildRoomRosterHtml(pilgrimageReport());
    expect(html).toContain("李&lt;大&gt;華");
    expect(html).not.toContain("李<大>華");
  });

  it("車次名單：一車一頁，列出每個人的房型與第幾間，最後是人數；沒人的車也有一頁", () => {
    const html = buildBusRosterHtml(pilgrimageReport());
    const pages = sections(html);
    expect(pages).toHaveLength(2);
    expect(text(pages[0].outerHTML)).toContain("第1車名單");
    expect(text(pages[0].outerHTML)).toContain("1 王小明 雙人房 第1間");
    expect(text(pages[0].outerHTML)).toContain("2 王太太 雙人房 第1間");
    expect(text(pages[0].outerHTML)).toContain("共 2 人");
    expect(text(pages[1].outerHTML)).toContain("共 1 人");

    const emptyBus = buildBusRosterHtml(pilgrimageReport({ registrations: [] }));
    expect(sections(emptyBus)).toHaveLength(2);
    expect(text(emptyBus)).toContain("這一車還沒有人報名");
  });

  it("車次名單：沒有車次的舊資料另外一頁「未指定車次」", () => {
    const html = buildBusRosterHtml(pilgrimageReport({ registrations: [reg({ participantName: "舊資料" })] }));
    expect(sections(html)).toHaveLength(3);
    expect(text(html)).toContain("未指定車次名單");
  });

  it("房型名單：每個房型一塊，同房的人排在同一列，標出已訂間數；沒人訂的房型也列出", () => {
    const t = text(buildRoomRosterHtml(pilgrimageReport()));
    expect(t).toContain("雙人房（每間 2 人，已訂 2／5 間）");
    expect(t).toContain("1 王小明、王太太 2 第1車");
    expect(t).toContain("2 李<大>華 1 第2車");
    expect(t).toContain("四人房（每間 4 人，已訂 0／2 間）");
    expect(t).toContain("尚無人預訂");
    expect(t).toContain("共 3 人");
  });

  it("報名名單（祭改）：依場次號碼列出", () => {
    const report = pilgrimageReport({
      ceremony: { name: "祭改", date: "2026-12-01", kind: CeremonyKind.JIGAI } as never,
      registrations: [reg({ participantName: "甲", session: CeremonySession.AM, queueNumber: 3, amount: 300 })],
    });
    expect(text(buildParticipantRosterHtml(report))).toContain("1 甲 上午場 3號 NT$ 300");
  });

  it("結算：進香依房型分列報名費（間數、人數），加上活動捐款；結餘 = 收入 − 支出；收禮依品項加總", () => {
    const s = computeSettlement(pilgrimageReport());
    expect(s.income).toEqual([
      { label: "報名費", detail: "雙人房（2 間、3 人）", amount: 9000 },
      { label: "活動捐款", detail: "共 1 筆", amount: 500 },
    ]);
    expect(s.expenses).toEqual([{ label: "交通", detail: "遊覽車　2026-12-01", amount: 1200 }]);
    expect(s).toMatchObject({ incomeTotal: 9500, expenseTotal: 1200, balance: 8300, giftCount: 2 });
    expect(s.giftTotals).toEqual([{ label: "鮮花", quantity: 3 }]);
  });

  it("結算：祭改依場次、餐會整體一列；沒有捐款就不列捐款", () => {
    const jigai = computeSettlement(
      pilgrimageReport({
        ceremony: { kind: CeremonyKind.JIGAI } as never,
        registrations: [
          reg({ session: CeremonySession.AM, amount: 300 }),
          reg({ session: CeremonySession.AM, amount: 300 }),
          reg({ session: CeremonySession.PM, amount: 300 }),
        ],
        donations: [],
        donationTotal: 0,
      }),
    );
    expect(jigai.income).toEqual([
      { label: "報名費", detail: "上午場（2 人）", amount: 600 },
      { label: "報名費", detail: "下午場（1 人）", amount: 300 },
    ]);
    const dinner = computeSettlement(
      pilgrimageReport({
        ceremony: { kind: CeremonyKind.GENERAL } as never,
        registrations: [reg({ amount: 1000 }), reg({ amount: 1000 })],
        donations: [],
        donationTotal: 0,
      }),
    );
    expect(dinner.income).toEqual([{ label: "報名費", detail: "報名（2 人）", amount: 2000 }]);
  });

  it("結算摘要頁：有收入、支出、結餘、捐款明細、收禮與簽核欄", () => {
    const t = text(buildSettlementHtml(pilgrimageReport()));
    for (const part of ["收入合計 NT$ 9,500", "支出合計 NT$ 1,200", "收入 − 支出 NT$ 8,300", "善心 添油香 NT$ 500", "收禮（共 2 筆）", "鮮花 3", "製表", "會計", "總幹事", "主任委員"]) {
      expect(t).toContain(part);
    }
    const empty = text(
      buildSettlementHtml(pilgrimageReport({ registrations: [], donations: [], donationTotal: 0, expenses: [], expenseTotal: 0, gifts: [], totalAmount: 0 })),
    );
    expect(empty).toContain("沒有收入");
    expect(empty).toContain("沒有列入此活動的支出");
    expect(empty).toContain("沒有登記為此活動的收禮紀錄");
  });
});
