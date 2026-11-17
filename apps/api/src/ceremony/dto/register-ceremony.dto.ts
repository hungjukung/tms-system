import { CeremonySession } from "@tms/shared";
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MaxLength } from "class-validator";

export class RegisterCeremonyDto {
  @IsUUID()
  ceremonyId: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
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

  /** 祭改活動：報名場次 */
  @IsOptional()
  @IsEnum(CeremonySession)
  session?: CeremonySession;

  /** 進香多人報名：每位參加者的信徒 id（第 1 位是報名者本人；臨櫃參加者填空字串，格式在 service 內另行檢查），陣列長度就是參加人數 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  passengerMemberIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  passengerNames?: string[];

  /** 進香：所選房型名稱（活動有設定房型時必填） */
  @IsOptional()
  @IsString()
  roomType?: string;
}
