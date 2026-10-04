import { LedgerEntryType } from "@tms/shared";
import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class CreateLedgerEntryDto {
  @IsUUID()
  templeId: string;

  @IsEnum(LedgerEntryType)
  type: LedgerEntryType;

  @IsString()
  @MaxLength(100)
  category: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  occurredAt: string;

  @IsOptional()
  @IsBoolean()
  isPettyCash?: boolean;

  /** 列入活動計算時填寫：這筆項目會額外統計進該活動的支出，仍照常計入財務報表總支出 */
  @IsOptional()
  @IsUUID()
  ceremonyId?: string;
}
