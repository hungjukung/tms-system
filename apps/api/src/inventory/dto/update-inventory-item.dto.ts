import { IsInt, IsString, Min } from "class-validator";

export class UpdateInventoryItemDto {
  @IsString()
  name: string;

  @IsString()
  unit: string;

  @IsInt()
  @Min(0)
  lowStockThreshold: number;
}
