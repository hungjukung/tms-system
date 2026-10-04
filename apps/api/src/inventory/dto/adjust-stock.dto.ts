import { InventoryTransactionType } from "@tms/shared";
import { IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";

export class AdjustStockDto {
  @IsEnum(InventoryTransactionType)
  type: InventoryTransactionType;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  note?: string;
}
