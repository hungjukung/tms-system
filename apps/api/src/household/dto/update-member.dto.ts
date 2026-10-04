import { Gender, MemberTagType } from "@tms/shared";
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

export class UpdateMemberDto {
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
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString({ strict: true })
  birthDateSolar?: string;

  @IsOptional()
  @IsString()
  birthDateLunar?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(MemberTagType, { each: true })
  tags?: MemberTagType[];

  @IsOptional()
  @IsUUID()
  householdId?: string;
}
