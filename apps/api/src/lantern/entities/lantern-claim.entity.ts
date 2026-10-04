import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { LanternSlot } from "./lantern-slot.entity";

@Entity("lantern_claims")
@Unique("uq_slot_year", ["slotId", "year"])
export class LanternClaim {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => LanternSlot, { onDelete: "CASCADE" })
  @JoinColumn({ name: "slotId" })
  slot: LanternSlot;

  @Column()
  slotId: string;

  @Column()
  year: number;

  @Column({ type: "varchar", nullable: true })
  memberId: string | null;

  @Column({ type: "varchar", nullable: true })
  walkInName: string | null; // 未建檔的臨櫃香客姓名

  @Column({ type: "text", nullable: true })
  wishText: string | null;

  /** 疏文：點燈時的正式祈福文書內容，與「祈願內容」分開存放 */
  @Column({ type: "text", nullable: true })
  petitionText: string | null;

  /** 點燈內容（例如「光明燈」「平安燈」），個別認領時可覆蓋燈牆預設名稱；未填時收據上改用燈牆名稱 */
  @Column({ type: "text", nullable: true })
  lanternType: string | null;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  amount: string;

  @Column()
  createdByUserId: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
