import { IsNumber, IsOptional, IsString, IsUUID, Matches, Min, MaxLength } from "class-validator";

export class ClaimSlotDto {
  @IsUUID()
  slotId: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  walkInName?: string;

  @IsOptional()
  @IsString()
  wishText?: string;

  /** 疏文：點燈時的正式祈福文書內容，與「祈願內容」分開存放，供列印疏文使用 */
  @IsOptional()
  @IsString()
  petitionText?: string;

  /** 點燈內容（例如「光明燈」「平安燈」，複選以「、」合併）：必填，不可為空白 */
  @IsString()
  @Matches(/\S/, { message: "點燈內容不可為空" })
  @MaxLength(100)
  lanternType: string;

  @IsNumber()
  @Min(0)
  amount: number;
}
