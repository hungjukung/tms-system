import { IsOptional, IsString, MinLength } from "class-validator";

export class UpdateOwnProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;
}
