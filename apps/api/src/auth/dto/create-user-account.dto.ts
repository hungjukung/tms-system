import { UserRole } from "@tms/shared";
import { IsEnum, IsString, MinLength } from "class-validator";

export class CreateUserAccountDto {
  @IsString()
  @MinLength(2)
  username: string;

  @IsString()
  @MinLength(4)
  password: string;

  @IsString()
  @MinLength(1)
  displayName: string;

  @IsEnum(UserRole)
  role: UserRole;
}
