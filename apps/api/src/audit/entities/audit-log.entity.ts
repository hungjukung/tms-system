import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * 操作紀錄：總幹事／唯讀帳號在「操作紀錄」頁查詢「誰在什麼時候做了什麼」。
 * 收據的開立／作廢另外記在 receipt_audit_logs，查詢時會合併顯示；這張表記其他需要留痕的操作
 * （調整進香房型／車次、建立／修改／刪除活動、永久刪除收據）。
 */
@Entity("audit_logs")
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 操作種類，例如 PILGRIMAGE_MOVE、CEREMONY_CREATE */
  @Column({ type: "varchar" })
  action: string;

  /** 被操作的對象種類（CEREMONY／REGISTRATION／RECEIPT） */
  @Column({ type: "varchar" })
  entityType: string;

  @Column({ type: "varchar", nullable: true })
  entityId: string | null;

  /** 給人看的一句話描述，記下當下的名稱與前後差異（之後對象被刪除也看得懂） */
  @Column({ type: "text" })
  summary: string;

  @Column({ type: "varchar" })
  performedByUserId: string;

  @Column({ type: "uuid", nullable: true })
  templeId: string | null;

  @Index()
  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
