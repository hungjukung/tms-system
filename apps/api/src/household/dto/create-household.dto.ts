import { IsOptional, IsString } from "class-validator";

export class CreateHouseholdDto {
  @IsString()
  address: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
