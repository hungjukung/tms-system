import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class RegisterCeremonyDto {
  @IsUUID()
  ceremonyId: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsString()
  walkInName?: string;

  @IsOptional()
  @IsString()
  walkInAddress?: string;

  @IsOptional()
  @IsUUID()
  householdId?: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  wishText?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  seatIndex?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  householdSeatIndexes?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  tableNumber?: number;

  /** 此人不需要座位（例如純捐款/隨喜，不會實際入座），即使活動有設定座位也不會佔用任何座位 */
  @IsOptional()
  @IsBoolean()
  noSeatNeeded?: boolean;
}
