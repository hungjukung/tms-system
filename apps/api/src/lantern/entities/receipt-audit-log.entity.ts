import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("receipt_audit_logs")
export class ReceiptAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  receiptId: string;

  @Column()
  action: "ISSUE" | "VOID";

  @Column()
  performedByUserId: string;

  @Column({ type: "text", nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
