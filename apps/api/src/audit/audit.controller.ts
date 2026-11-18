import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { positiveInt, requireDateParam } from "../common/query-utils";
import { AuditService } from "./audit.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("audit-logs")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /** 操作紀錄：只有總幹事（與唯讀帳號，守衛對唯讀帳號放行所有 GET）看得到 */
  @Get()
  @Roles(UserRole.DIRECTOR)
  list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.auditService.list({
      page: positiveInt(page, 1, 100000),
      pageSize: positiveInt(pageSize, 20, 100),
      action: action || undefined,
      from: from ? requireDateParam(from, "起始日期") : undefined,
      to: to ? requireDateParam(to, "結束日期") : undefined,
    });
  }
}
