import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { InventoryItemDto, InventoryTransactionDto, InventoryTransactionType } from "@tms/shared";
import { User } from "../auth/entities/user.entity";
import { InventoryItem } from "./entities/inventory-item.entity";
import { InventoryTransaction } from "./entities/inventory-transaction.entity";
import { CreateInventoryItemDto } from "./dto/create-inventory-item.dto";
import { AdjustStockDto } from "./dto/adjust-stock.dto";

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem) private readonly itemRepo: Repository<InventoryItem>,
    @InjectRepository(InventoryTransaction)
    private readonly transactionRepo: Repository<InventoryTransaction>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async createItem(dto: CreateInventoryItemDto): Promise<InventoryItemDto> {
    const item = this.itemRepo.create({
      name: dto.name,
      unit: dto.unit,
      lowStockThreshold: dto.lowStockThreshold,
      currentStock: dto.initialStock ?? 0,
    });
    const saved = await this.itemRepo.save(item);
    return this.toDto(saved);
  }

  async listItems(): Promise<InventoryItemDto[]> {
    const items = await this.itemRepo.find({ order: { name: "ASC" } });
    return items.map((i) => this.toDto(i));
  }

  async listLowStockItems(): Promise<InventoryItemDto[]> {
    const items = await this.itemRepo
      .createQueryBuilder("item")
      .where("item.currentStock <= item.lowStockThreshold")
      .orderBy("item.name", "ASC")
      .getMany();
    return items.map((i) => this.toDto(i));
  }

  async adjustStock(itemId: string, dto: AdjustStockDto, userId: string): Promise<InventoryItemDto> {
    const item = await this.itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException("找不到物資項目");

    if (dto.type === InventoryTransactionType.IN) {
      await this.itemRepo.increment({ id: itemId }, "currentStock", dto.quantity);
    } else {
      // 以條件式 UPDATE 確保並發扣庫存時不會扣成負數（多櫃台同時領用時的安全防護）
      const result = await this.itemRepo
        .createQueryBuilder()
        .update(InventoryItem)
        .set({ currentStock: () => `"currentStock" - :qty` })
        .where("id = :id AND \"currentStock\" >= :qty", { id: itemId, qty: dto.quantity })
        .setParameters({ qty: dto.quantity })
        .execute();
      if (result.affected === 0) {
        throw new ConflictException("庫存不足，無法領用此數量");
      }
    }

    await this.transactionRepo.save(
      this.transactionRepo.create({
        itemId,
        type: dto.type,
        quantity: dto.quantity,
        note: dto.note ?? null,
        createdByUserId: userId,
      }),
    );

    const updated = await this.itemRepo.findOne({ where: { id: itemId } });
    return this.toDto(updated!);
  }

  async listTransactions(itemId: string, limit = 50): Promise<InventoryTransactionDto[]> {
    const transactions = await this.transactionRepo.find({
      where: { itemId },
      order: { createdAt: "DESC" },
      take: limit,
    });
    const item = await this.itemRepo.findOne({ where: { id: itemId } });
    const userIds = [...new Set(transactions.map((t) => t.createdByUserId))];
    const users = userIds.length ? await this.userRepo.find({ where: { id: In(userIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, u.displayName]));
    return transactions.map((t) => ({
      id: t.id,
      itemId: t.itemId,
      itemName: item?.name ?? "",
      type: t.type,
      quantity: t.quantity,
      note: t.note,
      createdByName: userMap.get(t.createdByUserId) ?? "",
      createdAt: t.createdAt.toISOString(),
    }));
  }

  private toDto(item: InventoryItem): InventoryItemDto {
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      currentStock: item.currentStock,
      lowStockThreshold: item.lowStockThreshold,
      isLowStock: item.currentStock <= item.lowStockThreshold,
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
