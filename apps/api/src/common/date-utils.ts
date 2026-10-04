/** 用「電腦本機時間」的年/月/日組字串，刻意不透過 toISOString()（會受時區換算影響而跑掉一天） */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
