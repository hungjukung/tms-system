import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, In, MoreThanOrEqual, Not, Repository } from "typeorm";
import {
  FinancialReportDto,
  LedgerAuditDaySummaryDto,
  LedgerEntryDto,
  LedgerEntryStatus,
  LedgerEntryType,
  PETTY_CASH_CATEGORY_LABEL,
  PETTY_CASH_LEGACY_CATEGORY_LABEL,
} from "@tms/shared";
import { formatLocalDate } from "../common/date-utils";
import { User } from "../auth/entities/user.entity";
import { Temple } from "../settings/entities/temple.entity";
import { LanternService } from "../lantern/lantern.service";
import { LedgerEntry } from "./entities/ledger-entry.entity";
import { DailyAuditLog } from "./entities/daily-audit-log.entity";
import { CreateLedgerEntryDto } from "./dto/create-ledger-entry.dto";
import { ReviewLedgerEntryDto } from "./dto/review-ledger-entry.dto";

@Injectable()
export class FinanceService {
  constructor(
    @InjectRepository(LedgerEntry) private readonly ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(DailyAuditLog) private readonly auditLogRepo: Repository<DailyAuditLog>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Temple) private readonly templeRepo: Repository<Temple>,
    private readonly lanternService: LanternService,
  ) {}

  async createEntry(dto: CreateLedgerEntryDto, userId: string): Promise<LedgerEntryDto> {
    const entry = this.ledgerRepo.create({
      templeId: dto.templeId,
      type: dto.type,
      category: dto.category,
      amount: dto.amount.toFixed(2),
      description: dto.description ?? null,
      occurredAt: dto.occurredAt,
      status: LedgerEntryStatus.PENDING,
      createdByUserId: userId,
      isPettyCash: dto.isPettyCash ?? false,
      ceremonyId: dto.ceremonyId ?? null,
    });
    const saved = await this.ledgerRepo.save(entry);
    return this.toDto(saved);
  }

  /**
   * 「剩餘零用金」：撥補零用金（分類為「零用金撥補」的支出）總額，減去所有標記「從零用金支出」的支出總額。
   * 已駁回的項目視為沒發生，不計入；待審核與已核准都視為零用金箱已實際變動（現金已經撥出/花用）。
   * 若該廟設有 pettyCashResetAt（手動歸零基準點），只計入該時間點之後建立的項目，忽略更早的歷史紀錄。
   * 撥補項目同時比對新舊兩種分類字面字串（「零用金撥補」與已停用的「零用金」），
   * 避免功能改綁到新分類後，漏算改版前用舊分類建立的歷史撥補紀錄。
   */
  async getPettyCashBalance(templeId?: string): Promise<number> {
    const resetAt = templeId
      ? (await this.templeRepo.findOne({ where: { id: templeId } }))?.pettyCashResetAt ?? null
      : null;
    const baseWhere = {
      type: LedgerEntryType.EXPENSE,
      status: Not(LedgerEntryStatus.REJECTED),
      ...(templeId ? { templeId } : {}),
      ...(resetAt ? { createdAt: MoreThanOrEqual(resetAt) } : {}),
    };
    const topUps = await this.ledgerRepo.find({
      where: { ...baseWhere, category: In([PETTY_CASH_CATEGORY_LABEL, PETTY_CASH_LEGACY_CATEGORY_LABEL]) },
    });
    const draws = await this.ledgerRepo.find({
      where: { ...baseWhere, isPettyCash: true },
    });
    const totalTopUp = topUps.reduce((sum, e) => sum + Number(e.amount), 0);
    const totalDraw = draws.reduce((sum, e) => sum + Number(e.amount), 0);
    return totalTopUp - totalDraw;
  }

  /**
   * 手動將「剩餘零用金」歸零重新起算：只影響餘額計算基準點，不刪除任何歷史流水帳資料。
   * 基準點一律用資料庫伺服器的 NOW()，不可用應用程式端的 Date（兩邊時鐘可能有些微落差，
   * 一旦落差方向不巧導致基準點比同一秒建立的舊項目還早，就會漏篩掉該項目）。
   */
  async resetPettyCashBalance(templeId: string): Promise<{ balance: number }> {
    const result = await this.templeRepo
      .createQueryBuilder()
      .update(Temple)
      .set({ pettyCashResetAt: () => "NOW()" })
      .where("id = :id", { id: templeId })
      .execute();
    if (!result.affected) throw new NotFoundException("找不到廟宇");
    return { balance: await this.getPettyCashBalance(templeId) };
  }

  async listEntries(
    status?: LedgerEntryStatus,
    templeId?: string,
    from?: string,
    to?: string,
  ): Promise<LedgerEntryDto[]> {
    const entries = await this.ledgerRepo.find({
      where: {
        ...(status ? { status } : {}),
        ...(templeId ? { templeId } : {}),
        ...(from && to ? { occurredAt: Between(from, to) } : {}),
      },
      order: { occurredAt: "DESC", createdAt: "DESC" },
      take: 200,
    });
    return this.toDtoList(entries);
  }

  /**
   * 供「審核日誌」日曆使用：依交易日期彙總每天待審核／已核准／已駁回的手動流水帳筆數，
   * 並一併標示當天是否有已開立收據的收入（點燈/捐款/法會報名/送禮）、以及當天是否已完成審核確認。
   * 審核是以廟為單位進行的，故必須指定 templeId。
   */
  async getAuditCalendar(from: string, to: string, templeId: string): Promise<LedgerAuditDaySummaryDto[]> {
    if (!templeId) throw new BadRequestException("請先選擇一間廟宇才能查看審核日誌");

    const ledgerQuery = this.ledgerRepo
      .createQueryBuilder("entry")
      .select("to_char(entry.occurredAt, 'YYYY-MM-DD')", "date")
      .addSelect("entry.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("entry.occurredAt >= :from AND entry.occurredAt <= :to", { from, to })
      .andWhere("entry.templeId = :templeId", { templeId })
      .groupBy("entry.occurredAt")
      .addGroupBy("entry.status");
    const ledgerRows = await ledgerQuery.getRawMany<{ date: string; status: LedgerEntryStatus; count: string }>();

    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const receiptDates = await this.lanternService.getIssuedReceiptDates(start, end, templeId);

    const auditedLogs = await this.auditLogRepo.find({ where: { templeId, date: Between(from, to) } });
    const auditedDates = new Set(auditedLogs.map((a) => a.date));

    const map = new Map<string, LedgerAuditDaySummaryDto>();
    const ensure = (date: string): LedgerAuditDaySummaryDto => {
      let existing = map.get(date);
      if (!existing) {
        existing = { date, pendingCount: 0, approvedCount: 0, rejectedCount: 0, hasReceiptIncome: false, audited: false };
        map.set(date, existing);
      }
      return existing;
    };
    for (const row of ledgerRows) {
      const existing = ensure(row.date);
      const count = Number(row.count);
      if (row.status === LedgerEntryStatus.PENDING) existing.pendingCount += count;
      else if (row.status === LedgerEntryStatus.APPROVED) existing.approvedCount += count;
      else if (row.status === LedgerEntryStatus.REJECTED) existing.rejectedCount += count;
    }
    for (const date of receiptDates) ensure(date).hasReceiptIncome = true;
    for (const date of auditedDates) ensure(date).audited = true;

    return Array.from(map.values());
  }

  /** 「審核日誌」確認頁批次入帳：只核准目前仍為待審核的項目，已被處理過的 id 直接略過 */
  async batchApprove(ids: string[], userId: string): Promise<{ approvedCount: number }> {
    if (!ids.length) return { approvedCount: 0 };
    const entries = await this.ledgerRepo.find({ where: { id: In(ids), status: LedgerEntryStatus.PENDING } });
    const now = new Date();
    for (const entry of entries) {
      entry.status = LedgerEntryStatus.APPROVED;
      entry.reviewedByUserId = userId;
      entry.reviewedAt = now;
    }
    await this.ledgerRepo.save(entries);
    return { approvedCount: entries.length };
  }

  /**
   * 「審核日誌」確認頁按下「入帳」的另一半動作：把選定的日期標記為已審核（含當天所有已開立收據的收入 +
   * 手動流水帳項目，一併視為當天已完成核對），供日曆格子顯示綠色「已審核」。可重複標記同一天（更新審核人/時間）。
   */
  async confirmAudit(templeId: string, dates: string[], userId: string): Promise<{ auditedDates: string[] }> {
    if (!templeId) throw new BadRequestException("請先選擇一間廟宇才能進行審核");
    const uniqueDates = [...new Set(dates)];
    for (const date of uniqueDates) {
      const existing = await this.auditLogRepo.findOne({ where: { templeId, date } });
      if (existing) {
        existing.auditedByUserId = userId;
        existing.auditedAt = new Date();
        await this.auditLogRepo.save(existing);
      } else {
        await this.auditLogRepo.save(this.auditLogRepo.create({ templeId, date, auditedByUserId: userId }));
      }
    }
    return { auditedDates: uniqueDates };
  }

  async reviewEntry(id: string, dto: ReviewLedgerEntryDto, userId: string): Promise<LedgerEntryDto> {
    const entry = await this.ledgerRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException("找不到流水帳項目");
    if (entry.status !== LedgerEntryStatus.PENDING) {
      throw new ConflictException("此項目已經審核過了");
    }
    if (dto.action === "REJECT" && !dto.reason) {
      throw new BadRequestException("駁回時必須填寫原因");
    }
    entry.status = dto.action === "APPROVE" ? LedgerEntryStatus.APPROVED : LedgerEntryStatus.REJECTED;
    entry.reviewedByUserId = userId;
    entry.reviewedReason = dto.reason ?? null;
    entry.reviewedAt = new Date();
    const saved = await this.ledgerRepo.save(entry);
    return this.toDto(saved);
  }

  async getDailyReport(date: string, templeId?: string): Promise<FinancialReportDto> {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return this.buildReport(date, start, end, date, date, templeId);
  }

  async getMonthlyReport(year: number, month: number, templeId?: string): Promise<FinancialReportDto> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month, 0);
    const label = `${year}-${String(month).padStart(2, "0")}`;
    return this.buildReport(
      label,
      start,
      end,
      formatLocalDate(start),
      formatLocalDate(lastDayOfMonth),
      templeId,
    );
  }

  async getRangeReport(startDate: string, endDate: string, templeId?: string): Promise<FinancialReportDto> {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    end.setDate(end.getDate() + 1); // 結束日當天整天都算在區間內
    return this.buildReport(`${startDate} ~ ${endDate}`, start, end, startDate, endDate, templeId);
  }

  async getAnnualReport(year: number, templeId?: string): Promise<FinancialReportDto> {
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    const lastDayOfYear = new Date(year, 11, 31);
    return this.buildReport(
      `${year}`,
      start,
      end,
      formatLocalDate(start),
      formatLocalDate(lastDayOfYear),
      templeId,
    );
  }

  private async buildReport(
    periodLabel: string,
    start: Date,
    end: Date,
    occurredFrom: string,
    occurredTo: string,
    templeId?: string,
  ): Promise<FinancialReportDto> {
    const { byCategory: lanternIncomeByCategory, details: incomeDetails } =
      await this.lanternService.getIssuedIncomeReport(start, end, templeId);
    const lanternAndDonationIncome = lanternIncomeByCategory.reduce((sum, c) => sum + c.amount, 0);

    const entriesQuery = this.ledgerRepo
      .createQueryBuilder("entry")
      .where("entry.occurredAt >= :from AND entry.occurredAt <= :to", {
        from: occurredFrom,
        to: occurredTo,
      })
      .andWhere("entry.status = :status", { status: LedgerEntryStatus.APPROVED });
    if (templeId) {
      entriesQuery.andWhere("entry.templeId = :templeId", { templeId });
    }
    const entries = await entriesQuery.getMany();

    const pendingEntryCount = await this.ledgerRepo.count({
      where: { status: LedgerEntryStatus.PENDING, ...(templeId ? { templeId } : {}) },
    });

    const incomeEntries = entries.filter((e) => e.type === LedgerEntryType.INCOME);
    // 標記「從零用金支出」的支出，其現金早在撥補零用金當下就已計入總帳，這裡要排除以避免重複計算，
    // 但仍要單獨列出明細供查看（不計入 totalExpense/expenseByCategory/netAmount）
    const expenseEntries = entries.filter((e) => e.type === LedgerEntryType.EXPENSE && !e.isPettyCash);
    const pettyCashExpenseEntries = entries
      .filter((e) => e.type === LedgerEntryType.EXPENSE && e.isPettyCash)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    const ledgerIncome = incomeEntries.reduce((sum, e) => sum + Number(e.amount), 0);
    const totalExpense = expenseEntries.reduce((sum, e) => sum + Number(e.amount), 0);
    const pettyCashExpenseTotal = pettyCashExpenseEntries.reduce((sum, e) => sum + Number(e.amount), 0);

    const groupByCategory = (list: LedgerEntry[]) => {
      const map = new Map<string, number>();
      for (const e of list) {
        map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount));
      }
      return Array.from(map.entries()).map(([category, amount]) => ({
        category: category as any,
        amount,
      }));
    };

    const totalIncome = lanternAndDonationIncome + ledgerIncome;

    return {
      periodLabel,
      lanternAndDonationIncome,
      lanternIncomeByCategory,
      incomeDetails,
      ledgerIncome,
      ledgerIncomeByCategory: groupByCategory(incomeEntries),
      totalIncome,
      totalExpense,
      expenseByCategory: groupByCategory(expenseEntries),
      netAmount: totalIncome - totalExpense,
      pendingEntryCount,
      pettyCashExpenseTotal,
      pettyCashExpenseDetails: await this.toDtoList(pettyCashExpenseEntries),
    };
  }

  private async toDtoList(entries: LedgerEntry[]): Promise<LedgerEntryDto[]> {
    const userIds = [
      ...new Set(entries.flatMap((e) => [e.createdByUserId, e.reviewedByUserId].filter(Boolean) as string[])),
    ];
    const users = userIds.length ? await this.userRepo.find({ where: { id: In(userIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, u.displayName]));
    return Promise.all(entries.map((e) => this.toDto(e, userMap)));
  }

  private async toDto(entry: LedgerEntry, userMap?: Map<string, string>): Promise<LedgerEntryDto> {
    let map = userMap;
    if (!map) {
      const ids = [entry.createdByUserId, entry.reviewedByUserId].filter(Boolean) as string[];
      const users = await this.userRepo.find({ where: { id: In(ids) } });
      map = new Map(users.map((u) => [u.id, u.displayName]));
    }
    return {
      id: entry.id,
      templeId: entry.templeId,
      type: entry.type,
      category: entry.category,
      amount: Number(entry.amount),
      description: entry.description,
      occurredAt: entry.occurredAt,
      status: entry.status,
      isPettyCash: entry.isPettyCash,
      ceremonyId: entry.ceremonyId,
      createdByName: map.get(entry.createdByUserId) ?? "",
      reviewedByName: entry.reviewedByUserId ? map.get(entry.reviewedByUserId) ?? null : null,
      reviewedReason: entry.reviewedReason,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}
