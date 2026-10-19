import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { LanternWall } from "./lantern-wall.entity";

@Entity("lantern_slots")
@Unique("uq_wall_code", ["wallId", "code"])
export class LanternSlot {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => LanternWall, { onDelete: "CASCADE" })
  @JoinColumn({ name: "wallId" })
  wall: LanternWall;

  @Index()
  @Column()
  wallId: string;

  @Column()
  code: string; // 例如 A-01

  // 編號用的排號/格號（與 code 一致），依建立時選的橫向/縱向編號順序換算
  @Column({ type: "int" })
  row: number;

  @Column({ type: "int", name: "column" })
  column: number;

  // 在建立畫布上的實際位置（1 = 最上排／最左格），燈位圖依此排列
  @Column({ type: "int" })
  gridRow: number;

  @Column({ type: "int" })
  gridColumn: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
