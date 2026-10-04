import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("lantern_walls")
export class LanternWall {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  templeId: string;

  @Column()
  name: string; // 例如：大殿光明燈、太歲殿太歲燈

  @Column()
  year: number;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  slotPrice: string;

  @Column({ default: false })
  isTaisuiWall: boolean; // 太歲燈牆：點燈內容固定鎖定為「太歲燈」

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
