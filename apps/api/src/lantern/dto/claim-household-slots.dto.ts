import { IsArray, IsNumber, IsString, IsUUID, Matches, MaxLength, Min } from "class-validator";

export class ClaimHouseholdSlotsDto {
  @IsUUID()
  wallId: string;

  @IsUUID()
  householdId: string;

  @IsArray()
  @IsUUID("4", { each: true })
  slotIds: string[];

  /** 整戶點同一種燈：單一燈種，金額必須是「燈種價格 × 戶內人數」 */
  @IsString()
  @Matches(/\S/, { message: "點燈內容不可為空" })
  @MaxLength(100)
  lanternType: string;

  @IsNumber()
  @Min(0)
  amount: number;
}
