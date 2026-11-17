import { CeremonyFeeMode } from "@tms/shared";
import { Type } from "class-transformer";
import { IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min, ValidateNested } from "class-validator";
import { RoomTypeDto } from "./create-ceremony.dto";

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

  @IsOptional()
  @IsInt()
  @IsPositive()
  morningCapacity?: number | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  afternoonCapacity?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomTypeDto)
  roomTypes?: RoomTypeDto[] | null;
}
