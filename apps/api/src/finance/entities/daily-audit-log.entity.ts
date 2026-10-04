import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/** 「審核日誌」：標記某廟某天已完成當日收支審核（點燈/捐款/法會報名/送禮等已開立收據的收入 + 手動流水帳項目一併審核） */
@Entity("daily_audit_logs")
@Unique(["templeId", "date"])
export class DailyAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  templeId: string;

  @Column({ type: "date" })
  date: string;

  @Column()
  auditedByUserId: string;

  @CreateDateColumn({ type: "timestamptz" })
  auditedAt: Date;
}
