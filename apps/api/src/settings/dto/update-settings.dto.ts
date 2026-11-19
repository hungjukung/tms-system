import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class LanternTypePriceDto {
  @IsString()
  @MaxLength(20)
  name: string;

  @IsNumber()
  @Min(0)
  @Max(10000000)
  price: number;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  templeName?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  registrationNo?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  committeeName?: string;

  @IsOptional()
  @IsString()
  chairmanTitle?: string;

  @IsOptional()
  @IsString()
  chairmanName?: string;

  /** 點燈的燈種與價格（整份清單一次送來，取代原本的清單） */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => LanternTypePriceDto)
  lanternTypes?: LanternTypePriceDto[];
}
