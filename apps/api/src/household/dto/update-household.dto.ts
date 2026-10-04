import { IsOptional, IsString } from "class-validator";

export class UpdateHouseholdDto {
  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
