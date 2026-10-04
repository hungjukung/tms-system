import {
  CeremonyDto,
  CeremonyReportDto,
  CeremonySeatDto,
  CreateCeremonyRequest,
  MemberHistoryEntryDto,
  RegisterCeremonyCombinedResponse,
  RegisterCeremonyRequest,
  UpdateCeremonyRequest,
} from "@tms/shared";
import { apiClient } from "./client";

export async function listCeremonies(templeId?: string, activeOnly?: boolean): Promise<CeremonyDto[]> {
  const params: Record<string, string> = {};
  if (templeId) params.templeId = templeId;
  if (activeOnly) params.activeOnly = "true";
  const res = await apiClient.get<CeremonyDto[]>("/ceremony/ceremonies", { params });
  return res.data;
}

export async function createCeremony(dto: CreateCeremonyRequest): Promise<CeremonyDto> {
  const res = await apiClient.post<CeremonyDto>("/ceremony/ceremonies", dto);
  return res.data;
}

export async function updateCeremony(id: string, dto: UpdateCeremonyRequest): Promise<CeremonyDto> {
  const res = await apiClient.patch<CeremonyDto>(`/ceremony/ceremonies/${id}`, dto);
  return res.data;
}

export async function deleteCeremony(id: string, force = false): Promise<void> {
  await apiClient.delete(`/ceremony/ceremonies/${id}`, { params: force ? { force: "true" } : {} });
}

export async function getCeremonyMemberHistory(memberId: string): Promise<MemberHistoryEntryDto[]> {
  const res = await apiClient.get<MemberHistoryEntryDto[]>(`/ceremony/members/${memberId}/history`);
  return res.data;
}

export async function getCeremonySeats(ceremonyId: string): Promise<CeremonySeatDto[]> {
  const res = await apiClient.get<CeremonySeatDto[]>(`/ceremony/ceremonies/${ceremonyId}/seats`);
  return res.data;
}

export async function getCeremonyReport(ceremonyId: string): Promise<CeremonyReportDto> {
  const res = await apiClient.get<CeremonyReportDto>(`/ceremony/ceremonies/${ceremonyId}/report`);
  return res.data;
}

/** 「活動報名」頁一次報名多個活動使用：立即建立報名紀錄，收據留待與其他活動合併開立 */
export async function registerCeremonyCombined(
  dto: RegisterCeremonyRequest,
): Promise<RegisterCeremonyCombinedResponse> {
  const res = await apiClient.post<RegisterCeremonyCombinedResponse>("/ceremony/registrations/combined", dto);
  return res.data;
}

/** 供「活動報名」頁在送出並開立收據前，從加入清單中移除某筆尚未送出的報名項目使用 */
export async function cancelRegistration(registrationId: string): Promise<void> {
  await apiClient.delete(`/ceremony/registrations/${registrationId}`);
}
