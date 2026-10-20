import { LanternSlotDto } from "@tms/shared";

// 估算文字寬度：全形字約等於字級，半形字約字級的 0.6 倍（粗體再寬一點）
function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.62;
  return w;
}

/** 燈位格寬度：配合 index.css 的 .lantern-row（最小 90px、左右內距各 10px），留一點餘裕 */
export function lanternCellWidth(slot: LanternSlotDto): number {
  const codeW = textWidth(slot.code, 16);
  const nameW = slot.claim ? textWidth(slot.claim.memberName, 12) : 0;
  return Math.max(90, Math.ceil(Math.max(codeW, nameW)) + 28);
}
