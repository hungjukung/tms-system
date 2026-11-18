import dayjs from "dayjs";
import { CeremonyKind, CeremonyReportDto, CeremonySession } from "@tms/shared";
import { GIFT_LABEL, groupByRoom } from "./pilgrimageReport";

/**
 * 活動的列印版報表（A4 直式）：在瀏覽器裡組好 HTML，開新視窗列印，不需要經過後端。
 * - 車次名單：一車一頁，給遊覽車領隊點名（有簽到欄）
 * - 房型名單：每個房型一塊，一間房一列，給導遊排房
 * - 報名名單：餐會／祭改用，依座位或場次號碼列出
 * - 結算摘要：收入、支出、結餘與收禮，最後有簽核欄，給委員會看
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const money = (n: number) => `NT$ ${n.toLocaleString("en-US")}`;
const nameOf = (name: string) => name || "（未留姓名）";

function documentHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Microsoft JhengHei", "PMingLiU", sans-serif; color: #222; margin: 0; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 18px 0 6px; border-bottom: 2px solid #7a1f16; padding-bottom: 2px; color: #7a1f16; }
  .meta { color: #666; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f3ece4; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.check { width: 60px; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .block { page-break-inside: avoid; }
  .total { font-weight: bold; }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; gap: 16px; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; }
  .empty { color: #888; }
  @media screen { body { padding: 16px; max-width: 820px; margin: 0 auto; } }
</style></head>
<body>${body}</body></html>`;
}

function header(report: CeremonyReportDto, title: string): string {
  const c = report.ceremony;
  return `<h1>${escapeHtml(c.name)}　${escapeHtml(title)}</h1>
<div class="meta">活動日期：${escapeHtml(c.date)}　列印時間：${dayjs().format("YYYY-MM-DD HH:mm")}</div>`;
}

/** 車次名單：一車一頁，序號、姓名、房型、第幾間、簽到欄；沒有車次的舊資料另列一頁 */
export function buildBusRosterHtml(report: CeremonyReportDto): string {
  const busCount = report.ceremony.busCount ?? 0;
  const buses: (number | null)[] = [
    ...Array.from({ length: busCount }, (_, i) => i + 1),
    ...(report.registrations.some((r) => r.busNumber == null) ? [null] : []),
  ];
  if (buses.length === 0) buses.push(null);
  const pages = buses.map((bus) => {
    const list = report.registrations.filter((r) => (r.busNumber ?? null) === bus);
    const rows = list
      .map(
        (r, i) => `<tr><td class="num">${i + 1}</td><td>${escapeHtml(nameOf(r.participantName))}</td>
<td>${escapeHtml(r.roomType ?? "")}</td><td>${r.roomNumber != null ? `第${r.roomNumber}間` : ""}</td><td class="check"></td></tr>`,
      )
      .join("");
    return `<section class="page">${header(report, bus == null ? "未指定車次名單" : `第${bus}車名單`)}
<table><thead><tr><th class="num">序號</th><th>姓名</th><th>房型</th><th>第幾間</th><th>簽到</th></tr></thead>
<tbody>${rows || `<tr><td colspan="5" class="empty">這一車還沒有人報名</td></tr>`}</tbody></table>
<div class="total">共 ${list.length} 人</div></section>`;
  });
  return documentHtml(`${report.ceremony.name} 車次名單`, pages.join(""));
}

/** 房型名單：每個房型一塊，一間房一列，同房的人排在同一格 */
export function buildRoomRosterHtml(report: CeremonyReportDto): string {
  const groups = groupByRoom(report.registrations);
  const configured = report.ceremony.roomTypes ?? [];
  const typeNames = [
    ...configured.map((r) => r.name),
    ...Array.from(new Set(groups.map((g) => g.roomType).filter((n) => !configured.some((r) => r.name === n)))),
  ];
  const blocks = typeNames.map((type) => {
    const list = groups
      .filter((g) => g.roomType === type)
      .sort((a, b) => (a.roomNumber ?? 0) - (b.roomNumber ?? 0));
    const config = configured.find((r) => r.name === type);
    const rows = list
      .map(
        (g, i) => `<tr><td class="num">${g.roomNumber ?? i + 1}</td><td>${g.names.map((n) => escapeHtml(n)).join("、")}</td>
<td class="num">${g.names.length}</td><td>${g.busNumber != null ? `第${g.busNumber}車` : ""}</td></tr>`,
      )
      .join("");
    const title = type || "未分房型";
    const capacityText = config ? `（每間 ${config.capacity} 人，已訂 ${list.length}${config.roomCount != null ? `／${config.roomCount}` : ""} 間）` : "";
    return `<div class="block"><h2>${escapeHtml(title)}${capacityText}</h2>
<table><thead><tr><th class="num">第幾間</th><th>住房人員</th><th class="num">人數</th><th>車次</th></tr></thead>
<tbody>${rows || `<tr><td colspan="4" class="empty">尚無人預訂</td></tr>`}</tbody></table></div>`;
  });
  const people = report.registrations.length;
  return documentHtml(
    `${report.ceremony.name} 房型名單`,
    `${header(report, "房型名單")}${blocks.join("") || `<p class="empty">尚無報名資料</p>`}<div class="total">共 ${people} 人</div>`,
  );
}

/** 報名名單（餐會／祭改）：依座位或場次號碼列出 */
export function buildParticipantRosterHtml(report: CeremonyReportDto): string {
  const sessionLabel = (s: CeremonySession | null) => (s === CeremonySession.AM ? "上午場" : s === CeremonySession.PM ? "下午場" : "");
  const position = (r: CeremonyReportDto["registrations"][number]) =>
    r.queueNumber != null ? `${sessionLabel(r.session)} ${r.queueNumber}號`.trim() : (r.seatNumber ?? "");
  const rows = report.registrations
    .map(
      (r, i) => `<tr><td class="num">${i + 1}</td><td>${escapeHtml(nameOf(r.participantName))}</td>
<td>${escapeHtml(position(r))}</td><td class="num">${r.amount ? money(r.amount) : ""}</td><td class="check"></td></tr>`,
    )
    .join("");
  return documentHtml(
    `${report.ceremony.name} 報名名單`,
    `${header(report, "報名名單")}
<table><thead><tr><th class="num">序號</th><th>姓名</th><th>座位／號碼</th><th class="num">金額</th><th>簽到</th></tr></thead>
<tbody>${rows || `<tr><td colspan="5" class="empty">尚無報名資料</td></tr>`}</tbody></table>
<div class="total">共 ${report.registrations.length} 人</div>`,
  );
}

export interface SettlementLine {
  label: string;
  detail: string;
  amount: number;
}

/** 結算的數字：報名費依活動種類細分（進香依房型、祭改依場次），加上活動捐款；支出逐筆列出 */
export function computeSettlement(report: CeremonyReportDto) {
  const income: SettlementLine[] = [];
  const kind = report.ceremony.kind;
  if (kind === CeremonyKind.PILGRIMAGE) {
    const groups = groupByRoom(report.registrations);
    for (const type of Array.from(new Set(groups.map((g) => g.roomType)))) {
      const list = groups.filter((g) => g.roomType === type);
      income.push({
        label: "報名費",
        detail: `${type || "未分房型"}（${list.length} 間、${list.reduce((s, g) => s + g.names.length, 0)} 人）`,
        amount: list.reduce((s, g) => s + g.amount, 0),
      });
    }
  } else if (kind === CeremonyKind.JIGAI) {
    for (const [session, label] of [
      [CeremonySession.AM, "上午場"],
      [CeremonySession.PM, "下午場"],
    ] as const) {
      const list = report.registrations.filter((r) => r.session === session);
      if (list.length) {
        income.push({ label: "報名費", detail: `${label}（${list.length} 人）`, amount: list.reduce((s, r) => s + r.amount, 0) });
      }
    }
  } else if (report.registrations.length) {
    income.push({
      label: "報名費",
      detail: `報名（${report.registrations.length} 人）`,
      amount: report.registrations.reduce((s, r) => s + r.amount, 0),
    });
  }
  if (report.donations.length) {
    income.push({ label: "活動捐款", detail: `共 ${report.donations.length} 筆`, amount: report.donationTotal });
  }
  const expenses: SettlementLine[] = report.expenses.map((e) => ({
    label: e.category,
    detail: [e.description ?? "", e.occurredAt].filter(Boolean).join("　"),
    amount: e.amount,
  }));
  const incomeTotal = report.totalAmount + report.donationTotal;
  const giftTotals = new Map<string, number>();
  for (const g of report.gifts) {
    const label = GIFT_LABEL[g.giftType] ?? g.giftType;
    giftTotals.set(label, (giftTotals.get(label) ?? 0) + g.quantity);
  }
  return {
    income,
    expenses,
    incomeTotal,
    expenseTotal: report.expenseTotal,
    balance: incomeTotal - report.expenseTotal,
    giftTotals: [...giftTotals.entries()].map(([label, quantity]) => ({ label, quantity })),
    giftCount: report.gifts.length,
  };
}

/** 結算摘要：一頁看完收入、支出、結餘與收禮，最後是簽核欄 */
export function buildSettlementHtml(report: CeremonyReportDto): string {
  const s = computeSettlement(report);
  const lineRows = (lines: SettlementLine[], empty: string) =>
    lines.length
      ? lines
          .map((l) => `<tr><td>${escapeHtml(l.label)}</td><td>${escapeHtml(l.detail)}</td><td class="num">${money(l.amount)}</td></tr>`)
          .join("")
      : `<tr><td colspan="3" class="empty">${empty}</td></tr>`;
  const donorRows = report.donations
    .map((d) => `<tr><td>${escapeHtml(nameOf(d.payerName))}</td><td>${escapeHtml(d.note ?? "")}</td><td class="num">${money(d.amount)}</td></tr>`)
    .join("");
  const giftRows = s.giftTotals.map((g) => `<tr><td>${escapeHtml(g.label)}</td><td class="num">${g.quantity}</td></tr>`).join("");
  const body = `${header(report, "結算摘要")}
<h2>收入</h2>
<table><thead><tr><th>類別</th><th>項目</th><th class="num">金額</th></tr></thead>
<tbody>${lineRows(s.income, "沒有收入")}<tr class="total"><td colspan="2">收入合計</td><td class="num">${money(s.incomeTotal)}</td></tr></tbody></table>
<h2>支出</h2>
<table><thead><tr><th>類別</th><th>說明</th><th class="num">金額</th></tr></thead>
<tbody>${lineRows(s.expenses, "沒有列入此活動的支出")}<tr class="total"><td colspan="2">支出合計</td><td class="num">${money(s.expenseTotal)}</td></tr></tbody></table>
<h2>結餘</h2>
<table><tbody><tr class="total"><td>收入 − 支出</td><td class="num">${money(s.balance)}</td></tr></tbody></table>
${report.donations.length ? `<h2>活動捐款明細</h2><table><thead><tr><th>捐款人</th><th>備註</th><th class="num">金額</th></tr></thead><tbody>${donorRows}</tbody></table>` : ""}
<h2>收禮（共 ${s.giftCount} 筆）</h2>
${giftRows ? `<table><thead><tr><th>品項</th><th class="num">數量</th></tr></thead><tbody>${giftRows}</tbody></table>` : `<p class="empty">沒有登記為此活動的收禮紀錄</p>`}
<div class="sign"><div>製表</div><div>會計</div><div>總幹事</div><div>主任委員</div></div>`;
  return documentHtml(`${report.ceremony.name} 結算摘要`, body);
}

/** 開新視窗顯示列印版並叫出列印對話框；瀏覽器擋下彈出視窗時回傳 false */
export function openHtmlPrintWindow(html: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
  return true;
}
