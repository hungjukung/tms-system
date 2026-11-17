import { BadRequestException } from "@nestjs/common";

/** 分頁／筆數這類查詢參數：不是正整數（例如 0、負數、abc）就用預設值，並限制上限避免一次撈太多 */
export function positiveInt(value: unknown, fallback: number, max = 500): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** 必填的日期查詢參數（YYYY-MM-DD，而且要是真的存在的日期），不合格直接回 400 */
export function requireDateParam(value: unknown, label: string): string {
  const text = typeof value === "string" ? value : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return text;
  }
  throw new BadRequestException(`${label}格式不正確，請使用 YYYY-MM-DD`);
}

/** 必填的整數查詢參數（例如年份、月份），不在範圍內直接回 400 */
export function requireIntParam(value: unknown, label: string, min: number, max: number): number {
  const n = Number(value);
  if (value === undefined || value === "" || !Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${label}不正確`);
  }
  return n;
}
