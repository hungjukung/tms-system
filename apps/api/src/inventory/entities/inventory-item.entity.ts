import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("inventory_items")
export class InventoryItem {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  name: string; // 例如：金紙、香、線香、發財米、平安符

  @Column()
  unit: string; // 例如：支、包、份

  @Column({ type: "int", default: 0 })
  currentStock: number;

  @Column({ type: "int" })
  lowStockThreshold: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt: Date;
}
