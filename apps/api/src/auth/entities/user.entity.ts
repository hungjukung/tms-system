import { UserRole } from "@tms/shared";
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  passwordHash: string;

  @Column()
  displayName: string;

  @Column({ type: "enum", enum: UserRole, default: UserRole.VOLUNTEER })
  role: UserRole;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
