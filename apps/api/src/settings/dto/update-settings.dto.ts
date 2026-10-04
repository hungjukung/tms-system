import { IsOptional, IsString } from "class-validator";

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
}
