import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { InventoryItem } from "./entities/inventory-item.entity";
import { InventoryTransaction } from "./entities/inventory-transaction.entity";
import { User } from "../auth/entities/user.entity";
import { InventoryService } from "./inventory.service";
import { InventoryController } from "./inventory.controller";

@Module({
  imports: [TypeOrmModule.forFeature([InventoryItem, InventoryTransaction, User])],
  providers: [InventoryService],
  controllers: [InventoryController],
})
export class InventoryModule {}
