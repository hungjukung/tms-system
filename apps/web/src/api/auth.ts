import { AuthUser, ChangeOwnPasswordRequest, UpdateOwnProfileRequest } from "@tms/shared";
import { apiClient } from "./client";

export async function updateOwnProfile(dto: UpdateOwnProfileRequest): Promise<AuthUser> {
  const res = await apiClient.patch<AuthUser>("/auth/me", dto);
  return res.data;
}

export async function changeOwnPassword(dto: ChangeOwnPasswordRequest): Promise<void> {
  await apiClient.post("/auth/me/change-password", dto);
}
