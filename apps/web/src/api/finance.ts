import {
  BatchApproveLedgerEntriesResponse,
  ConfirmAuditResponse,
  CreateLedgerEntryRequest,
  FinancialReportDto,
  LedgerAuditDaySummaryDto,
  LedgerEntryDto,
  LedgerEntryStatus,
  PettyCashBalanceDto,
  ReviewLedgerEntryRequest,
} from "@tms/shared";
import { apiClient } from "./client";

export async function createLedgerEntry(dto: CreateLedgerEntryRequest): Promise<LedgerEntryDto> {
  const res = await apiClient.post<LedgerEntryDto>("/finance/ledger-entries", dto);
  return res.data;
}

export async function listLedgerEntries(
  status?: LedgerEntryStatus,
  templeId?: string,
  from?: string,
  to?: string,
): Promise<LedgerEntryDto[]> {
  const res = await apiClient.get<LedgerEntryDto[]>("/finance/ledger-entries", {
    params: {
      ...(status ? { status } : {}),
      ...(templeId ? { templeId } : {}),
      ...(from && to ? { from, to } : {}),
    },
  });
  return res.data;
}

export async function getPettyCashBalance(templeId?: string): Promise<PettyCashBalanceDto> {
  const res = await apiClient.get<PettyCashBalanceDto>("/finance/ledger-entries/petty-cash-balance", {
    params: { ...(templeId ? { templeId } : {}) },
  });
  return res.data;
}

export async function resetPettyCashBalance(templeId: string): Promise<PettyCashBalanceDto> {
  const res = await apiClient.post<PettyCashBalanceDto>("/finance/ledger-entries/petty-cash-reset", { templeId });
  return res.data;
}

export async function getAuditCalendar(
  from: string,
  to: string,
  templeId: string,
): Promise<LedgerAuditDaySummaryDto[]> {
  const res = await apiClient.get<LedgerAuditDaySummaryDto[]>("/finance/ledger-entries/audit-calendar", {
    params: { from, to, templeId },
  });
  return res.data;
}

export async function batchApproveLedgerEntries(ids: string[]): Promise<BatchApproveLedgerEntriesResponse> {
  const res = await apiClient.post<BatchApproveLedgerEntriesResponse>("/finance/ledger-entries/batch-review", {
    ids,
  });
  return res.data;
}

export async function confirmAudit(templeId: string, dates: string[]): Promise<ConfirmAuditResponse> {
  const res = await apiClient.post<ConfirmAuditResponse>("/finance/ledger-entries/confirm-audit", {
    templeId,
    dates,
  });
  return res.data;
}

export async function reviewLedgerEntry(
  id: string,
  dto: ReviewLedgerEntryRequest,
): Promise<LedgerEntryDto> {
  const res = await apiClient.post<LedgerEntryDto>(`/finance/ledger-entries/${id}/review`, dto);
  return res.data;
}

export async function getDailyReport(date: string, templeId?: string): Promise<FinancialReportDto> {
  const res = await apiClient.get<FinancialReportDto>("/finance/reports/daily", {
    params: { date, ...(templeId ? { templeId } : {}) },
  });
  return res.data;
}

export async function getMonthlyReport(year: number, month: number, templeId?: string): Promise<FinancialReportDto> {
  const res = await apiClient.get<FinancialReportDto>("/finance/reports/monthly", {
    params: { year, month, ...(templeId ? { templeId } : {}) },
  });
  return res.data;
}

export async function getRangeReport(start: string, end: string, templeId?: string): Promise<FinancialReportDto> {
  const res = await apiClient.get<FinancialReportDto>("/finance/reports/range", {
    params: { start, end, ...(templeId ? { templeId } : {}) },
  });
  return res.data;
}

export async function getAnnualReport(year: number, templeId?: string): Promise<FinancialReportDto> {
  const res = await apiClient.get<FinancialReportDto>("/finance/reports/annual", {
    params: { year, ...(templeId ? { templeId } : {}) },
  });
  return res.data;
}
