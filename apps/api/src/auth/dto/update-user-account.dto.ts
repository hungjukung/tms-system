import { UserRole } from "@tms/shared";
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateUserAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
