import { Gender, MemberTagType } from "@tms/shared";
import { IsArray, IsDateString, IsEnum, IsOptional, IsString } from "class-validator";

export class CreateMemberDto {
  @IsString()
  householdAddress: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsEnum(Gender)
  gender: Gender;

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
}
