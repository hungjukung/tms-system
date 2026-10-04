import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("temples")
export class Temple {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // 廟宇簡稱，用於切換器顯示，例如「中埔」「水尾」
  @Column({ unique: true })
  name: string;

  @Column({ default: "宮廟名稱" })
  templeName: string;

  @Column({ type: "varchar", nullable: true })
  address: string | null;

  @Column({ type: "varchar", nullable: true })
  phone: string | null;

  @Column({ type: "varchar", nullable: true })
  registrationNo: string | null; // 立案證號

  @Column({ type: "varchar", nullable: true })
  taxId: string | null; // 統一編號

  @Column({ type: "varchar", nullable: true })
  committeeName: string | null; // 例如：OO宮管理委員會

  @Column({ default: "主任委員" })
  chairmanTitle: string;

  @Column({ type: "varchar", nullable: true })
  chairmanName: string | null;

  @Column({ type: "varchar", nullable: true })
  templeSealImagePath: string | null; // 宮廟印信圖檔（相對 URL 路徑）

  @Column({ type: "varchar", nullable: true })
  chairmanSealImagePath: string | null; // 主委簽章圖檔（相對 URL 路徑）

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  /** 「剩餘零用金」計算基準點：設定後只計入此時間點之後的零用金撥補／支出，用於手動歸零重新起算 */
  @Column({ type: "timestamptz", nullable: true })
  pettyCashResetAt: Date | null;
}
