import { DonationType } from "@tms/shared";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class CreateDonationDto {
  @IsUUID()
  templeId: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsString()
  walkInName?: string;

  @IsEnum(DonationType)
  type: DonationType;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;

  /** 自訂捐款項目名稱：僅總幹事可填寫 */
  @IsOptional()
  @IsString()
  customItem?: string;

  /** 自訂捐款項目數量：僅總幹事可填寫 */
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  /** 指定捐給某個活動時填寫：這筆捐款會獨立歸入該活動的收入，不計入一般捐款分類統計 */
  @IsOptional()
  @IsUUID()
  ceremonyId?: string;
}
