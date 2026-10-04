import { Gender, MemberTagType } from "@tms/shared";
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Household } from "./household.entity";

@Entity("members")
export class Member {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Household, { onDelete: "CASCADE" })
  @JoinColumn({ name: "householdId" })
  household: Household;

  @Column()
  householdId: string;

  @Index()
  @Column()
  name: string;

  @Column({ type: "varchar", nullable: true })
  phone: string | null;

  // 信徒本人的地址，可能與所屬戶籍地址不同（例如子女已搬出但仍算同一戶籍）
  @Column({ type: "text", nullable: true })
  address: string | null;

  @Column({ type: "enum", enum: Gender, default: Gender.UNKNOWN })
  gender: Gender;

  @Column({ type: "date", nullable: true })
  birthDateSolar: string | null;

  @Column({ type: "varchar", nullable: true })
  birthDateLunar: string | null;

  @Column({ type: "varchar", nullable: true })
  zodiac: string | null;

  @Column({ type: "text", array: true, default: () => "'{}'" })
  tags: MemberTagType[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
