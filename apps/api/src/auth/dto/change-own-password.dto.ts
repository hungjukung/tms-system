import { IsString, MinLength } from "class-validator";

export class ChangeOwnPasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(4)
  newPassword: string;
}
