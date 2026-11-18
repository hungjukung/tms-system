import { AuditLogDto } from "@tms/shared";
import { apiClient } from "./client";

export async function listAuditLogs(params: {
  page: number;
  pageSize: number;
  action?: string;
  from?: string;
  to?: string;
}): Promise<{ items: AuditLogDto[]; total: number }> {
  const res = await apiClient.get<{ items: AuditLogDto[]; total: number }>("/audit-logs", { params });
  return res.data;
}
