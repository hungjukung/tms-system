import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

export class BulkImportMemberRowDto {
  @IsOptional()
  @IsString()
  householdKey?: string;

  @IsOptional()
  @IsString()
  householdAddress?: string;

  @IsOptional()
  @IsString()
  householdPhone?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  birthDateSolar?: string;

  @IsOptional()
  @IsString()
  tags?: string;
}

export class BulkImportMembersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkImportMemberRowDto)
  rows: BulkImportMemberRowDto[];
}
