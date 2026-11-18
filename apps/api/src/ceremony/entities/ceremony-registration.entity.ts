import { CeremonySession } from "@tms/shared";
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
@Unique("uq_ceremony_session_number", ["ceremonyId", "session", "queueNumber"])
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

  /** 祭改：報名場次（上午／下午）與該場號碼（從 1 號起） */
  @Column({ type: "varchar", nullable: true })
  session: CeremonySession | null;

  @Column({ type: "int", nullable: true })
  queueNumber: number | null;

  /** 進香：所訂房型名稱與第幾間（同一筆報名的參加者住同一間，第幾間相同） */
  @Column({ type: "varchar", nullable: true })
  roomType: string | null;

  @Column({ type: "int", nullable: true })
  roomNumber: number | null;

  /** 進香：搭乘的車次（第幾車），每車座位數固定 PILGRIMAGE_BUS_SEAT_COUNT */
  @Column({ type: "int", nullable: true })
  busNumber: number | null;

  @Column()
  createdByUserId: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
