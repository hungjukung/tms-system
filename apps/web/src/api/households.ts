import {
  BulkImportMemberRow,
  BulkImportMembersResponse,
  CreateHouseholdRequest,
  CreateMemberRequest,
  HouseholdDto,
  MemberDto,
  UpdateHouseholdRequest,
  UpdateMemberRequest,
} from "@tms/shared";
import { apiClient } from "./client";

export async function listHouseholds(): Promise<HouseholdDto[]> {
  const res = await apiClient.get<HouseholdDto[]>("/households");
  return res.data;
}

export async function createHousehold(dto: CreateHouseholdRequest): Promise<HouseholdDto> {
  const res = await apiClient.post<HouseholdDto>("/households", dto);
  return res.data;
}

/** 整戶報名等流程使用：透過地址或戶內成員姓名搜尋戶籍 */
export async function searchHouseholds(keyword: string, page = 1, pageSize = 20) {
  const res = await apiClient.get<{ items: HouseholdDto[]; total: number }>("/households/search", {
    params: { keyword, page, pageSize },
  });
  return res.data;
}

export async function getHouseholdMembers(householdId: string): Promise<MemberDto[]> {
  const res = await apiClient.get<MemberDto[]>(`/households/${householdId}/members`);
  return res.data;
}

export async function updateHousehold(id: string, dto: UpdateHouseholdRequest): Promise<HouseholdDto> {
  const res = await apiClient.patch<HouseholdDto>(`/households/${id}`, dto);
  return res.data;
}

export async function deleteHousehold(id: string): Promise<void> {
  await apiClient.delete(`/households/${id}`);
}

export async function createMember(dto: CreateMemberRequest): Promise<MemberDto> {
  const res = await apiClient.post<MemberDto>("/members", dto);
  return res.data;
}

export async function searchMembers(keyword: string, page = 1, pageSize = 20) {
  const res = await apiClient.get<{ items: MemberDto[]; total: number }>("/members", {
    params: { keyword, page, pageSize },
  });
  return res.data;
}

export async function getMember(id: string): Promise<MemberDto> {
  const res = await apiClient.get<MemberDto>(`/members/${id}`);
  return res.data;
}

export async function updateMember(id: string, dto: UpdateMemberRequest): Promise<MemberDto> {
  const res = await apiClient.patch<MemberDto>(`/members/${id}`, dto);
  return res.data;
}

export async function deleteMember(id: string, force = false): Promise<void> {
  await apiClient.delete(`/members/${id}`, { params: force ? { force: "true" } : {} });
}

export async function importMembers(rows: BulkImportMemberRow[]): Promise<BulkImportMembersResponse> {
  const res = await apiClient.post<BulkImportMembersResponse>("/households/import", { rows });
  return res.data;
}
