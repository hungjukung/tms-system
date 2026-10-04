import * as XLSX from "xlsx";
import dayjs from "dayjs";
import { BulkImportMemberRow } from "@tms/shared";
import { exportRowsToExcel } from "./export";

/** 除了 BulkImportMemberRow 本身的欄位外，生日拆成年/月/日三欄與郵遞區號是額外的解析用欄位 */
type ParsedField = keyof BulkImportMemberRow | "birthYear" | "birthMonth" | "birthDay" | "postalCode";

const HEADER_ALIASES: Record<ParsedField, string[]> = {
  householdKey: ["戶號", "戶號(可有可無)", "戶號（可有可無）"],
  householdAddress: ["戶籍地址", "地址", "地址addr1"],
  householdPhone: ["戶電話", "戶籍電話", "家用電話", "電話tel"],
  name: ["姓名", "信徒姓名", "姓名name"],
  phone: ["電話", "手機", "手機號碼", "手機_bir2"],
  address: ["信徒地址", "本人地址", "居住地址"],
  gender: ["性別", "性別sex"],
  birthDateSolar: ["生日", "生日(西元)", "生日（西元）", "國曆生日"],
  tags: ["標籤"],
  birthYear: ["年", "年yy"],
  birthMonth: ["月", "月mm"],
  birthDay: ["日", "日dd"],
  postalCode: ["郵遞區號", "郵遞區號pos"],
};

function normalizeHeader(header: string): string {
  return header.replace(/\s+/g, "").trim();
}

function buildHeaderMap(headers: string[]): Partial<Record<ParsedField, string>> {
  const map: Partial<Record<ParsedField, string>> = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ParsedField, string[]][]) {
      if (aliases.some((alias) => normalizeHeader(alias) === normalized)) {
        map[field] = header;
        break;
      }
    }
  }
  return map;
}

function normalizeDate(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return dayjs(value).format("YYYY-MM-DD");
  const text = String(value).trim();
  if (!text) return "";
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : text;
}

/** 把「年（民國）/月/日」三個獨立欄位換算成西元生日，供舊式戶政/宮廟資料表匯入使用 */
function buildRocBirthDate(yearRaw: unknown, monthRaw: unknown, dayRaw: unknown): string {
  const year = parseInt(String(yearRaw ?? "").trim(), 10);
  const month = parseInt(String(monthRaw ?? "").trim(), 10);
  const day = parseInt(String(dayRaw ?? "").trim(), 10);
  if (!year || !month || !day) return "";
  const westernYear = year + 1911;
  const date = dayjs(`${westernYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  return date.isValid() ? date.format("YYYY-MM-DD") : "";
}

/** 讀取使用者上傳的 Excel 檔案，轉成一鍵匯入信徒 API 需要的列資料 */
export async function parseMemberImportFile(file: File): Promise<BulkImportMemberRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (raw.length === 0) return [];

  const headerMap = buildHeaderMap(Object.keys(raw[0]));
  const get = (row: Record<string, unknown>, field: ParsedField) => {
    const header = headerMap[field];
    return header ? row[header] : undefined;
  };

  return raw.map((row) => {
    const postalCode = String(get(row, "postalCode") ?? "").trim();
    const addressText = String(get(row, "householdAddress") ?? "").trim();
    const householdAddress = postalCode ? `${postalCode} ${addressText}`.trim() : addressText;

    // 生日：優先採用單一日期欄位；沒有的話才用年/月/日三欄（年份視為民國年）組合換算
    const directDate = normalizeDate(get(row, "birthDateSolar"));
    const birthDateSolar =
      directDate || buildRocBirthDate(get(row, "birthYear"), get(row, "birthMonth"), get(row, "birthDay"));

    return {
      householdKey: String(get(row, "householdKey") ?? "").trim() || undefined,
      householdAddress,
      householdPhone: String(get(row, "householdPhone") ?? "").trim() || undefined,
      name: String(get(row, "name") ?? "").trim(),
      phone: String(get(row, "phone") ?? "").trim() || undefined,
      address: String(get(row, "address") ?? "").trim() || undefined,
      gender: String(get(row, "gender") ?? "").trim() || undefined,
      birthDateSolar: birthDateSolar || undefined,
      tags: String(get(row, "tags") ?? "").trim() || undefined,
    };
  });
}

/** 下載一鍵匯入信徒用的 Excel 範本，附一列範例資料方便使用者比照格式填寫 */
export function downloadMemberImportTemplate() {
  const headers = ["戶籍地址", "戶電話", "姓名", "電話", "信徒地址（留空則同戶籍地址）", "性別", "生日(西元)", "標籤"];
  const sample = ["嘉義縣中埔鄉大同路100號", "05-2361234", "王小明", "0912345678", "", "男", "1990-01-01", "一般信徒"];
  exportRowsToExcel("信徒匯入範本.xlsx", "信徒資料", headers, [sample]);
}
