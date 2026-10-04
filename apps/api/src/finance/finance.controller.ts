import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { LedgerEntryStatus, UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequestUser } from "../auth/jwt-payload.interface";
import { FinanceService } from "./finance.service";
import { CreateLedgerEntryDto } from "./dto/create-ledger-entry.dto";
import { ReviewLedgerEntryDto } from "./dto/review-ledger-entry.dto";
import { BatchApproveLedgerEntriesDto } from "./dto/batch-approve-ledger-entries.dto";
import { ConfirmAuditDto } from "./dto/confirm-audit.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("finance")
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post("ledger-entries")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  createEntry(@Body() dto: CreateLedgerEntryDto, @CurrentUser() user: RequestUser) {
    return this.financeService.createEntry(dto, user.userId);
  }

  @Get("ledger-entries")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  listEntries(
    @Query("status") status?: LedgerEntryStatus,
    @Query("templeId") templeId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.financeService.listEntries(status, templeId, from, to);
  }

  /** 供「新增流水帳項目」表單即時顯示「剩餘零用金」使用 */
  @Get("ledger-entries/petty-cash-balance")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  getPettyCashBalance(@Query("templeId") templeId?: string) {
    return this.financeService.getPettyCashBalance(templeId).then((balance) => ({ balance }));
  }

  /** 手動將「剩餘零用金」歸零重新起算，僅財務／總幹事可操作 */
  @Post("ledger-entries/petty-cash-reset")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  resetPettyCashBalance(@Body("templeId") templeId: string) {
    return this.financeService.resetPettyCashBalance(templeId);
  }

  /** 供「審核日誌」日曆使用：依交易日期彙總每天的審核狀態 */
  @Get("ledger-entries/audit-calendar")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  getAuditCalendar(
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("templeId") templeId: string,
  ) {
    return this.financeService.getAuditCalendar(from, to, templeId);
  }

  /** 「審核日誌」確認頁按下「入帳」：把選定日期標記為已審核（含當天所有收據收入 + 手動流水帳項目） */
  @Post("ledger-entries/confirm-audit")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  confirmAudit(@Body() dto: ConfirmAuditDto, @CurrentUser() user: RequestUser) {
    return this.financeService.confirmAudit(dto.templeId, dto.dates, user.userId);
  }

  @Post("ledger-entries/:id/review")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  reviewEntry(
    @Param("id") id: string,
    @Body() dto: ReviewLedgerEntryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.financeService.reviewEntry(id, dto, user.userId);
  }

  /** 「審核日誌」確認頁按下「入帳」：批次核准選定的項目 */
  @Post("ledger-entries/batch-review")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  batchApprove(@Body() dto: BatchApproveLedgerEntriesDto, @CurrentUser() user: RequestUser) {
    return this.financeService.batchApprove(dto.ids, user.userId);
  }

  @Get("reports/daily")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  getDailyReport(@Query("date") date: string, @Query("templeId") templeId?: string) {
    return this.financeService.getDailyReport(date, templeId);
  }

  @Get("reports/monthly")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  getMonthlyReport(
    @Query("year") year: string,
    @Query("month") month: string,
    @Query("templeId") templeId?: string,
  ) {
    return this.financeService.getMonthlyReport(Number(year), Number(month), templeId);
  }

  @Get("reports/range")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  getRangeReport(
    @Query("start") start: string,
    @Query("end") end: string,
    @Query("templeId") templeId?: string,
  ) {
    return this.financeService.getRangeReport(start, end, templeId);
  }

  @Get("reports/annual")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  getAnnualReport(@Query("year") year: string, @Query("templeId") templeId?: string) {
    return this.financeService.getAnnualReport(Number(year), templeId);
  }
}
