import { InventoryTransactionType } from "@tms/shared";
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { InventoryItem } from "./inventory-item.entity";

@Entity("inventory_transactions")
export class InventoryTransaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => InventoryItem, { onDelete: "CASCADE" })
  @JoinColumn({ name: "itemId" })
  item: InventoryItem;

  @Column()
  itemId: string;

  @Column({ type: "enum", enum: InventoryTransactionType })
  type: InventoryTransactionType;

  @Column({ type: "int" })
  quantity: number;

  @Column({ type: "text", nullable: true })
  note: string | null;

  @Column()
  createdByUserId: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
