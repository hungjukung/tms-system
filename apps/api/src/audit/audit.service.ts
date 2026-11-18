import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditLogDto } from "@tms/shared";
import { AuditLog } from "./entities/audit-log.entity";

export interface AuditRecordInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  userId: string;
  templeId?: string | null;
}

/** 收據開立／作廢記在 receipt_audit_logs，這裡把它們換成同一套操作種類名稱一起列出 */
const RECEIPT_ACTION_SQL = `CASE r.action WHEN 'VOID' THEN 'RECEIPT_VOID' ELSE 'RECEIPT_ISSUE' END`;

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>) {}

  /** 記一筆操作紀錄。留痕失敗不能讓正事跟著失敗（例如房型已經換好了），所以吞掉錯誤並印出警告 */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          summary: input.summary,
          performedByUserId: input.userId,
          templeId: input.templeId ?? null,
        }),
      );
    } catch (err) {
      console.warn("寫入操作紀錄失敗", err);
    }
  }

  /**
   * 合併「操作紀錄」與「收據開立／作廢紀錄」，依時間新到舊分頁。
   * from／to 是台灣日期（YYYY-MM-DD，含 to 當天）。
   */
  async list(params: {
    page: number;
    pageSize: number;
    action?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: AuditLogDto[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (params.action) {
      args.push(params.action);
      where.push(`x.action = $${args.length}`);
    }
    if (params.from) {
      args.push(`${params.from}T00:00:00+08:00`);
      where.push(`x."createdAt" >= $${args.length}::timestamptz`);
    }
    if (params.to) {
      args.push(`${params.to}T00:00:00+08:00`);
      where.push(`x."createdAt" < ($${args.length}::timestamptz + interval '1 day')`);
    }
    const base = `
      FROM (
        SELECT a.id::text AS id, a.action, a."entityType", a.summary,
               a."performedByUserId" AS "userId", a."createdAt"
          FROM audit_logs a
        UNION ALL
        SELECT r.id::text, ${RECEIPT_ACTION_SQL}, 'RECEIPT',
               '收據 ' || COALESCE(rc."receiptNo", '（已刪除）')
                 || COALESCE('　NT$ ' || regexp_replace(to_char(rc.amount, 'FM999,999,999,990.00'), '\\.00$', ''), '')
                 || COALESCE('　原因：' || r.reason, ''),
               r."performedByUserId", r."createdAt"
          FROM receipt_audit_logs r
          LEFT JOIN receipts rc ON rc.id::text = r."receiptId"
      ) x
      LEFT JOIN users u ON u.id::text = x."userId"
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;

    const countRows = await this.auditRepo.query(`SELECT COUNT(*)::int AS total ${base}`, args);
    const rows = await this.auditRepo.query(
      `SELECT x.id, x.action, x."entityType", x.summary, x."createdAt", u."displayName" AS "userName"
       ${base}
       ORDER BY x."createdAt" DESC, x.id DESC
       LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}`,
      args,
    );
    return {
      total: countRows[0]?.total ?? 0,
      items: rows.map((r: { id: string; action: string; entityType: string; summary: string; createdAt: Date; userName: string | null }) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        summary: r.summary,
        userName: r.userName ?? "（已刪除的帳號）",
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    };
  }
}
