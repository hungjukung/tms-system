import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { Ceremony } from "./ceremony.entity";

@Entity("ceremony_registrations")
@Unique("uq_ceremony_seat", ["ceremonyId", "seatIndex"])
export class CeremonyRegistration {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Ceremony, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ceremonyId" })
  ceremony: Ceremony;

  @Column()
  ceremonyId: string;

  @Column({ type: "uuid", nullable: true })
  memberId: string | null;

  @Column({ type: "varchar", nullable: true })
  walkInName: string | null;

  @Column({ type: "varchar", nullable: true })
  walkInAddress: string | null;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  amount: string;

  @Column({ type: "text", nullable: true })
  wishText: string | null; // 祈願內容（祈福文疏用）

  @Column({ type: "int", nullable: true })
  seatIndex: number | null; // 座位流水號（1 起算），用於換算桌號與座號

  @Column({ type: "varchar", nullable: true })
  seatNumber: string | null; // 例如 "1-1" 代表第一桌一號

  @Column()
  createdByUserId: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
