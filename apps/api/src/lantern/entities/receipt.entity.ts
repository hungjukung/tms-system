import { ReceiptItemDto, ReceiptSourceType, ReceiptStatus } from "@tms/shared";
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("receipts")
export class Receipt {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  templeId: string;

  @Column({ unique: true })
  receiptNo: string;

  @Column({ type: "enum", enum: ReceiptSourceType })
  sourceType: ReceiptSourceType;

  // 合併收據（COMBINED）沒有單一來源，此欄位為 null
  @Column({ type: "text", nullable: true })
  sourceId: string | null;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  amount: string;

  // 僅合併收據使用：開立當下直接記錄付款人姓名，不必回頭反查各筆來源紀錄
  @Column({ type: "text", nullable: true })
  payerName: string | null;

  // 僅合併收據使用：本張收據涵蓋的各活動項目與金額，供列印時逐行列出
  @Column({ type: "jsonb", nullable: true })
  items: ReceiptItemDto[] | null;

  @Column({ type: "enum", enum: ReceiptStatus, default: ReceiptStatus.ISSUED })
  status: ReceiptStatus;

  @Column()
  issuedByUserId: string;

  @Column({ type: "uuid", nullable: true })
  voidedByUserId: string | null;

  @Column({ type: "text", nullable: true })
  voidedReason: string | null;

  @Column({ type: "timestamptz", nullable: true })
  voidedAt: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
