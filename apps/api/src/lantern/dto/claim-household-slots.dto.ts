import { IsArray, IsNumber, IsUUID, Min } from "class-validator";

export class ClaimHouseholdSlotsDto {
  @IsUUID()
  wallId: string;

  @IsUUID()
  householdId: string;

  @IsArray()
  @IsUUID("4", { each: true })
  slotIds: string[];

  @IsNumber()
  @Min(0)
  amount: number;
}
