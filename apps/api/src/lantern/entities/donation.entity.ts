import { DonationType } from "@tms/shared";
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("donations")
export class Donation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  templeId: string;

  @Column({ type: "uuid", nullable: true })
  memberId: string | null;

  @Column({ type: "varchar", nullable: true })
  walkInName: string | null; // 未建檔的臨櫃香客姓名

  @Column({ type: "enum", enum: DonationType })
  type: DonationType;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  amount: string;

  @Column({ type: "text", nullable: true })
  note: string | null;

  /** 自訂捐款項目名稱：僅總幹事可填寫，用於補充固定分類以外的具體品項描述 */
  @Column({ type: "text", nullable: true })
  customItem: string | null;

  /** 自訂捐款項目數量：僅總幹事可填寫，需搭配 customItem 使用 */
  @Column({ type: "int", nullable: true })
  quantity: number | null;

  /** 指定捐給某個活動時填寫：這筆捐款獨立歸入該活動的收入，不計入一般捐款分類統計 */
  @Column({ type: "uuid", nullable: true })
  ceremonyId: string | null;

  @Column()
  createdByUserId: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
