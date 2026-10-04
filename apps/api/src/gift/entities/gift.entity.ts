import { GiftType } from "@tms/shared";
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("gifts")
export class Gift {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  templeId: string;

  @Column({ type: "uuid", nullable: true })
  memberId: string | null;

  @Column({ type: "varchar", nullable: true })
  walkInName: string | null; // 未建檔的臨櫃捐贈者姓名

  @Column({ type: "enum", enum: GiftType })
  giftType: GiftType;

  @Column({ type: "int", default: 1 })
  quantity: number;

  @Column()
  createdByUserId: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
