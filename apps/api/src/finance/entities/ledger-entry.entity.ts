import { LedgerEntryStatus, LedgerEntryType } from "@tms/shared";
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("ledger_entries")
export class LedgerEntry {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  templeId: string;

  @Column({ type: "enum", enum: LedgerEntryType })
  type: LedgerEntryType;

  @Column({ type: "varchar", length: 100 })
  category: string;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  amount: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "date" })
  occurredAt: string;

  @Column({ type: "enum", enum: LedgerEntryStatus, default: LedgerEntryStatus.PENDING })
  status: LedgerEntryStatus;

  @Column({ type: "boolean", default: false })
  isPettyCash: boolean;

  /** 列入活動計算時填寫：這筆項目會額外統計進該活動的支出，本身仍照常計入財務報表總支出 */
  @Column({ type: "uuid", nullable: true })
  ceremonyId: string | null;

  @Column()
  createdByUserId: string;

  @Column({ type: "uuid", nullable: true })
  reviewedByUserId: string | null;

  @Column({ type: "text", nullable: true })
  reviewedReason: string | null;

  @Column({ type: "timestamptz", nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
