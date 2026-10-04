/** 「點燈內容」下拉選單為複選，資料庫欄位仍是單一字串，故以「、」分隔合併/還原 */
export function splitLanternType(value: string | null | undefined): string[] {
  return value ? value.split("、").filter(Boolean) : [];
}

export function joinLanternType(values: string[] | undefined): string | null {
  return values && values.length > 0 ? values.join("、") : null;
}
