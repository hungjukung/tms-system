import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("households")
export class Household {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  address: string;

  @Column({ type: "varchar", nullable: true })
  phone: string | null;

  @Column({ type: "uuid", nullable: true })
  headMemberId: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
