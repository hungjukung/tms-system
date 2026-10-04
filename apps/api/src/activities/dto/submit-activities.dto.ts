import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { CreateDonationDto } from "../../lantern/dto/create-donation.dto";
import { ClaimSlotDto } from "../../lantern/dto/claim-slot.dto";
import { ClaimHouseholdSlotsDto } from "../../lantern/dto/claim-household-slots.dto";
import { RegisterCeremonyDto } from "../../ceremony/dto/register-ceremony.dto";
import { CreateGiftDto } from "../../gift/dto/create-gift.dto";

export class SubmitActivitiesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateDonationDto)
  donation?: CreateDonationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateGiftDto)
  gift?: CreateGiftDto;

  /**
   * 尚未建立紀錄的點燈認領（單人）：送出當下才真正卡位並建立紀錄，避免「加入」後忘記送出留下沒有收據的孤兒資料。
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimSlotDto)
  pendingLanternClaims?: ClaimSlotDto[];

  /** 尚未建立紀錄的整戶點燈：送出當下才真正卡位並建立紀錄 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimHouseholdSlotsDto)
  pendingHouseholdLanternClaims?: ClaimHouseholdSlotsDto[];

  /** 尚未建立紀錄的法會報名（單人／整戶／認領整桌皆可）：送出當下才真正配位並建立紀錄 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterCeremonyDto)
  pendingCeremonyRegistrations?: RegisterCeremonyDto[];

  @IsOptional()
  @IsString()
  fallbackPayerName?: string;

  @IsOptional()
  @IsString()
  fallbackTempleId?: string;
}
