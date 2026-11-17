import { GiftType } from "@tms/shared";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested, MaxLength } from "class-validator";

export class GiftItemDto {
  @IsEnum(GiftType)
  giftType: GiftType;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateGiftDto {
  @IsUUID()
  templeId: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  walkInName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GiftItemDto)
  items: GiftItemDto[];
}
