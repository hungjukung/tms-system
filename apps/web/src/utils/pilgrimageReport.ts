import dayjs from "dayjs";
import { CeremonyRegistrationDto, CeremonyReportDto, GiftType } from "@tms/shared";
import { SHOW_PILGRIMAGE_BUS } from "./features";

export type SheetRows = (string | number)[][];
export interface ReportSheet {
  name: string;
  rows: SheetRows;
}

export const GIFT_LABEL: Record<GiftType, string> = {
  [GiftType.FLOWERS]: "鮮花",
  [GiftType.LONGEVITY]: "壽桃壽麵",
  [GiftType.WATER]: "水",
  [GiftType.BEER]: "啤酒",
  [GiftType.DRINKS]: "飲料",
  [GiftType.OTHER]: "其他",
};

const timeText = (iso: string) => dayjs(iso).format("YYYY-MM-DD HH:mm");
const nameOf = (r: CeremonyRegistrationDto) => r.participantName || "（未留姓名）";

/** 同一間房的參加者（同房型、同房號；沒有房型的舊資料以收據分組）合成一列 */
export interface RoomGroup {
  roomType: string;
  roomNumber: number | null;
  names: string[];
  amount: number;
  firstTime: string;
  busNumber: number | null;
}

export function groupByRoom(registrations: CeremonyRegistrationDto[]): RoomGroup[] {
  const groups = new Map<string, RoomGroup>();
  for (const r of registrations) {
    const roomType = r.roomType ?? "";
    const key = r.roomType ? `${r.roomType}#${r.roomNumber ?? ""}` : `none#${r.receiptId ?? r.id}`;
    const group = groups.get(key) ?? {
      roomType,
      roomNumber: r.roomNumber,
      names: [],
      amount: 0,
      firstTime: r.createdAt,
      busNumber: r.busNumber,
    };
    group.names.push(nameOf(r));
    group.amount += r.amount;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** 房型名單：每個房型一塊，標題列是房型名稱，每間房一列（項次是第幾間），參加者橫向排開 */
function roomRosterSheet(report: CeremonyReportDto): ReportSheet {
  const groups = groupByRoom(report.registrations);
  const configured = report.ceremony.roomTypes ?? [];
  const typeNames = [
    ...configured.map((r) => r.name),
    ...Array.from(new Set(groups.map((g) => g.roomType).filter((n) => n && !configured.some((r) => r.name === n)))),
  ];
  const rows: SheetRows = [];
  const addBlock = (title: string, capacity: number, list: RoomGroup[]) => {
    const columns = Math.max(capacity, ...list.map((g) => g.names.length), 1);
    rows.push([title, ...Array(columns).fill("參加者"), "金額", "報名時間"]);
    list.forEach((g, i) => {
      rows.push([
        g.roomNumber ?? i + 1,
        ...Array.from({ length: columns }, (_, c) => g.names[c] ?? ""),
        g.amount,
        timeText(g.firstTime),
      ]);
    });
  };
  for (const name of typeNames) {
    const list = groups
      .filter((g) => g.roomType === name)
      .sort((a, b) => (a.roomNumber ?? 0) - (b.roomNumber ?? 0));
    if (list.length === 0 && !configured.some((r) => r.name === name)) continue;
    if (rows.length > 0) rows.push([]);
    addBlock(name, configured.find((r) => r.name === name)?.capacity ?? 1, list);
  }
  const unassigned = groups.filter((g) => !g.roomType);
  if (unassigned.length > 0) {
    if (rows.length > 0) rows.push([]);
    addBlock("未分房型", 1, unassigned);
  }
  if (rows.length === 0) rows.push(["尚無報名資料"]);
  return { name: "房型名單", rows };
}

/** 車次名單：每一車一塊，列出搭乘的參加者與所住房型、第幾間 */
function busRosterSheet(report: CeremonyReportDto): ReportSheet {
  const busCount = report.ceremony.busCount ?? 0;
  const rows: SheetRows = [];
  const buses: (number | null)[] = [
    ...Array.from({ length: busCount }, (_, i) => i + 1),
    ...(report.registrations.some((r) => r.busNumber == null) ? [null] : []),
  ];
  for (const bus of buses) {
    const list = report.registrations.filter((r) => (r.busNumber ?? null) === bus);
    if (rows.length > 0) rows.push([]);
    rows.push([bus == null ? "未指定車次" : `第${bus}車`, "參加者", "房型", "第幾間", "報名時間"]);
    list.forEach((r, i) =>
      rows.push([i + 1, nameOf(r), r.roomType ?? "", r.roomNumber != null ? `第${r.roomNumber}間` : "", timeText(r.createdAt)]),
    );
    rows.push(["共", `${list.length} 人`]);
  }
  if (rows.length === 0) rows.push(["尚無車次資料"]);
  return { name: "車次名單", rows };
}

/** 收入支出總表：報名費（依房型）、活動捐款為收入，列入活動計算的支出為支出，最後算結餘 */
function summarySheet(report: CeremonyReportDto): ReportSheet {
  const rows: SheetRows = [["類別", "項目", "收入", "支出"]];
  const groups = groupByRoom(report.registrations);
  const typeNames = Array.from(new Set(groups.map((g) => g.roomType)));
  for (const type of typeNames) {
    const list = groups.filter((g) => g.roomType === type);
    const people = list.reduce((sum, g) => sum + g.names.length, 0);
    const amount = list.reduce((sum, g) => sum + g.amount, 0);
    rows.push(["報名費", `${type || "未分房型"}（${list.length} 間、${people} 人）`, amount, ""]);
  }
  rows.push(["活動捐款", `共 ${report.donations.length} 筆`, report.donationTotal, ""]);
  for (const e of report.expenses) {
    rows.push(["支出", [e.category, e.description ?? "", e.occurredAt].filter(Boolean).join(" "), "", e.amount]);
  }
  const income = report.totalAmount + report.donationTotal;
  rows.push([]);
  rows.push(["合計", "", income, report.expenseTotal]);
  rows.push(["結餘", "收入 − 支出", income - report.expenseTotal, ""]);
  return { name: "收入支出總表", rows };
}

/** 收禮資訊：送禮時指定屬於此活動的禮與各品項合計 */
function giftSheet(report: CeremonyReportDto): ReportSheet {
  const rows: SheetRows = [
    ["（送禮時指定屬於此活動的禮）"],
    ["送禮人", "品項", "數量", "收禮時間"],
    ...report.gifts.map((g) => [g.giverName || "（未留姓名）", GIFT_LABEL[g.giftType] ?? g.giftType, g.quantity, timeText(g.createdAt)]),
  ];
  if (report.gifts.length === 0) rows.push(["（沒有登記為此活動的收禮紀錄）"]);
  const totals = new Map<string, number>();
  for (const g of report.gifts) {
    const label = GIFT_LABEL[g.giftType] ?? g.giftType;
    totals.set(label, (totals.get(label) ?? 0) + g.quantity);
  }
  if (totals.size > 0) {
    rows.push([]);
    rows.push(["品項合計", "品項", "數量"]);
    for (const [label, qty] of totals) rows.push(["", label, qty]);
  }
  return { name: "收禮資訊", rows };
}

/** 進香總表（一個 Excel 四個工作表）：房型名單、車次名單、收入支出總表、收禮資訊 */
export function buildPilgrimageWorkbook(report: CeremonyReportDto): ReportSheet[] {
  return [
    roomRosterSheet(report),
    ...(SHOW_PILGRIMAGE_BUS ? [busRosterSheet(report)] : []),
    summarySheet(report),
    giftSheet(report),
  ];
}
