import { CreateUserAccountRequest, UpdateUserAccountRequest, UserAccountDto } from "@tms/shared";
import { apiClient } from "./client";

export async function listUsers(): Promise<UserAccountDto[]> {
  const res = await apiClient.get<UserAccountDto[]>("/auth/users");
  return res.data;
}

export async function createUserAccount(dto: CreateUserAccountRequest): Promise<UserAccountDto> {
  const res = await apiClient.post<UserAccountDto>("/auth/users", dto);
  return res.data;
}

export async function updateUserAccount(id: string, dto: UpdateUserAccountRequest): Promise<UserAccountDto> {
  const res = await apiClient.patch<UserAccountDto>(`/auth/users/${id}`, dto);
  return res.data;
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await apiClient.post(`/auth/users/${id}/reset-password`, { password });
}

export async function deleteUserAccount(id: string): Promise<void> {
  await apiClient.delete(`/auth/users/${id}`);
}
