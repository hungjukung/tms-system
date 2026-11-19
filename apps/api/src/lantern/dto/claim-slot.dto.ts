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

  /** 點燈內容（燈種，例如「光明燈」「平安燈(大)」）：必填，必須是系統設定裡的其中一種；金額等於該燈種價格 */
  @IsString()
  @Matches(/\S/, { message: "點燈內容不可為空" })
  @MaxLength(100)
  lanternType: string;

  @IsNumber()
  @Min(0)
  amount: number;
}
