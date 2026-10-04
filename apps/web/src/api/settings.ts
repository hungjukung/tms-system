import { TempleSettingsDto, UpdateTempleSettingsRequest } from "@tms/shared";
import { apiClient } from "./client";

export async function getSettings(templeId: string): Promise<TempleSettingsDto> {
  const res = await apiClient.get<TempleSettingsDto>(`/settings/${templeId}`);
  return res.data;
}

export async function updateSettings(
  templeId: string,
  dto: UpdateTempleSettingsRequest,
): Promise<TempleSettingsDto> {
  const res = await apiClient.put<TempleSettingsDto>(`/settings/${templeId}`, dto);
  return res.data;
}

async function uploadSeal(
  templeId: string,
  kind: "temple-seal" | "chairman-seal",
  file: File,
): Promise<TempleSettingsDto> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiClient.post<TempleSettingsDto>(`/settings/${templeId}/${kind}`, formData);
  return res.data;
}

export const uploadTempleSeal = (templeId: string, file: File) => uploadSeal(templeId, "temple-seal", file);
export const uploadChairmanSeal = (templeId: string, file: File) => uploadSeal(templeId, "chairman-seal", file);
