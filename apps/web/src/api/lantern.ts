import {
  ClaimHouseholdLanternSlotsRequest,
  ClaimLanternSlotRequest,
  CreateLanternWallRequest,
  GenerateLanternSlotsRequest,
  LanternSlotDto,
  LanternWallDto,
  MemberHistoryEntryDto,
  ReceiptDto,
  UpdateLanternClaimRequest,
  UpdateLanternWallRequest,
} from "@tms/shared";
import { apiClient } from "./client";

export async function listWalls(templeId?: string): Promise<LanternWallDto[]> {
  const res = await apiClient.get<LanternWallDto[]>("/lantern/walls", { params: templeId ? { templeId } : {} });
  return res.data;
}

export async function createWall(dto: CreateLanternWallRequest): Promise<LanternWallDto> {
  const res = await apiClient.post<LanternWallDto>("/lantern/walls", dto);
  return res.data;
}

/** 修改燈牆的點燈內容（例如「光明燈」「平安燈」） */
export async function updateWall(wallId: string, dto: UpdateLanternWallRequest): Promise<LanternWallDto> {
  const res = await apiClient.patch<LanternWallDto>(`/lantern/walls/${wallId}`, dto);
  return res.data;
}

export async function generateSlots(wallId: string, dto: GenerateLanternSlotsRequest): Promise<void> {
  await apiClient.post(`/lantern/walls/${wallId}/slots`, dto);
}

/** 刪除燈牆（連同底下所有燈位）；已有信眾點燈時後端會回傳 409，需帶 force=true 才會一併刪除 */
export async function deleteWall(id: string, force = false): Promise<void> {
  await apiClient.delete(`/lantern/walls/${id}`, { params: force ? { force: "true" } : {} });
}

export async function getWallSlots(wallId: string): Promise<LanternSlotDto[]> {
  const res = await apiClient.get<LanternSlotDto[]>(`/lantern/walls/${wallId}/slots`);
  return res.data;
}

/** 「活動報名」頁合併收據流程使用：選位當下先卡位，收據留待與其他活動合併開立 */
export async function claimSlotCombined(dto: ClaimLanternSlotRequest): Promise<{
  slot: LanternSlotDto;
  claimId: string;
  payerName: string;
  description: string;
  note?: string;
  templeId: string;
}> {
  const res = await apiClient.post("/lantern/claims/combined", dto);
  return res.data;
}

/** 「活動報名」頁整戶點燈使用：一次認領同一面燈牆上與戶籍人數相同的多個燈位，選位當下先卡位，收據留待與其他活動合併開立 */
export async function claimHouseholdSlotsCombined(dto: ClaimHouseholdLanternSlotsRequest): Promise<{
  payerName: string;
  description: string;
  note: string;
  templeId: string;
  claimIds: string[];
}> {
  const res = await apiClient.post("/lantern/claims/household-combined", dto);
  return res.data;
}

/** 修正已認領燈位的姓名／祈願內容輸入錯誤；金額已核發收據，不開放在此修改 */
export async function updateClaim(claimId: string, dto: UpdateLanternClaimRequest): Promise<LanternSlotDto> {
  const res = await apiClient.patch<LanternSlotDto>(`/lantern/claims/${claimId}`, dto);
  return res.data;
}

/** 供「活動報名」頁在送出並開立收據前，從加入清單中移除某筆尚未送出的點燈項目使用 */
export async function cancelClaim(claimId: string): Promise<void> {
  await apiClient.delete(`/lantern/claims/${claimId}`);
}

export async function voidReceipt(id: string, reason: string): Promise<ReceiptDto> {
  const res = await apiClient.post<ReceiptDto>(`/lantern/receipts/${id}/void`, { reason });
  return res.data;
}

/** 真正從資料庫永久刪除收據（不同於作廢），僅總幹事可操作，無法復原 */
export async function deleteReceipt(id: string): Promise<void> {
  await apiClient.delete(`/lantern/receipts/${id}`);
}

export async function getMemberHistory(memberId: string): Promise<MemberHistoryEntryDto[]> {
  const res = await apiClient.get<MemberHistoryEntryDto[]>(`/lantern/members/${memberId}/history`);
  return res.data;
}
