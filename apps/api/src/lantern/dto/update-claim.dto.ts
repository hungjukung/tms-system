import { IsOptional, IsString, IsUUID } from "class-validator";

export class UpdateLanternClaimDto {
  @IsOptional()
  @IsUUID()
  memberId?: string | null;

  @IsOptional()
  @IsString()
  walkInName?: string | null;

  @IsOptional()
  @IsString()
  wishText?: string | null;

  @IsOptional()
  @IsString()
  petitionText?: string | null;

  /** 點燈內容（例如「光明燈」「平安燈」），未填時收據上改用燈牆名稱 */
  @IsOptional()
  @IsString()
  lanternType?: string | null;
}
