import { CeremonyFeeMode } from "@tms/shared";
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("ceremonies")
export class Ceremony {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  templeId: string;

  @Column()
  name: string; // 例如：中元普渡、消災活動

  @Column({ type: "date" })
  date: string;

  /** 報名期限：超過此日期後，此活動會從「活動報名」頁的選單隱藏（仍會保留在建立活動頁的歷史紀錄與財務查詢中） */
  @Column({ type: "date", nullable: true })
  registrationDeadline: string | null;

  @Column({ type: "enum", enum: CeremonyFeeMode })
  feeMode: CeremonyFeeMode;

  @Column({ type: "numeric", precision: 10, scale: 2, nullable: true })
  fixedAmount: string | null;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "int", nullable: true })
  tableCount: number | null; // 桌數

  @Column({ type: "int", nullable: true })
  seatsPerTable: number | null; // 每桌人數

  /** 已配發的座位數（內部座位計數器，透過原子性 UPDATE 遞增以避免並發搶位重複） */
  @Column({ type: "int", default: 0 })
  nextSeatIndex: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
