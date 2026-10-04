import { CeremonyFeeMode } from "@tms/shared";
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from "class-validator";

export class UpdateCeremonyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsEnum(CeremonyFeeMode)
  feeMode?: CeremonyFeeMode;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedAmount?: number | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  tableCount?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  seatsPerTable?: number | null;

  @IsOptional()
  @IsDateString()
  registrationDeadline?: string | null;
}
