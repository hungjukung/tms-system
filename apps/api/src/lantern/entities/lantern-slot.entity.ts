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

  // 建立時在畫布上點選的排號/格號，供「燈位表」依原始形狀排列顯示
  @Column({ type: "int" })
  row: number;

  @Column({ type: "int", name: "column" })
  column: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
