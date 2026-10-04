import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateInventoryItemDto {
  @IsString()
  name: string;

  @IsString()
  unit: string;

  @IsInt()
  @Min(0)
  lowStockThreshold: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  initialStock?: number;
}
