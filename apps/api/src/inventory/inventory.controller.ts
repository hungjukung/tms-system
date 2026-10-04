import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequestUser } from "../auth/jwt-payload.interface";
import { InventoryService } from "./inventory.service";
import { CreateInventoryItemDto } from "./dto/create-inventory-item.dto";
import { AdjustStockDto } from "./dto/adjust-stock.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post("items")
  @Roles(UserRole.DIRECTOR)
  createItem(@Body() dto: CreateInventoryItemDto) {
    return this.inventoryService.createItem(dto);
  }

  @Get("items")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  listItems() {
    return this.inventoryService.listItems();
  }

  @Get("items/low-stock")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  listLowStockItems() {
    return this.inventoryService.listLowStockItems();
  }

  @Post("items/:id/adjust")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  adjustStock(@Param("id") id: string, @Body() dto: AdjustStockDto, @CurrentUser() user: RequestUser) {
    return this.inventoryService.adjustStock(id, dto, user.userId);
  }

  @Get("items/:id/transactions")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  listTransactions(@Param("id") id: string, @Query("limit") limit = "50") {
    return this.inventoryService.listTransactions(id, Number(limit));
  }
}
