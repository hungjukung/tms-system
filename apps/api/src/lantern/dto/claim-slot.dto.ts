import { IsNumber, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class ClaimSlotDto {
  @IsUUID()
  slotId: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsString()
  walkInName?: string;

  @IsOptional()
  @IsString()
  wishText?: string;

  /** 疏文：點燈時的正式祈福文書內容，與「祈願內容」分開存放，供列印疏文使用 */
  @IsOptional()
  @IsString()
  petitionText?: string;

  /** 點燈內容（例如「光明燈」「平安燈」），未填時收據上改用燈牆名稱 */
  @IsOptional()
  @IsString()
  lanternType?: string;

  @IsNumber()
  @Min(0)
  amount: number;
}
