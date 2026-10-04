import { CeremonyFeeMode } from "@tms/shared";
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from "class-validator";

export class CreateCeremonyDto {
  @IsUUID()
  templeId: string;

  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsEnum(CeremonyFeeMode)
  feeMode: CeremonyFeeMode;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedAmount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  tableCount?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  seatsPerTable?: number;

  @IsOptional()
  @IsDateString()
  registrationDeadline?: string;
}
