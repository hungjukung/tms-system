import { CeremonyFeeMode, CeremonyKind } from "@tms/shared";
import { Type } from "class-transformer";
import { IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class RoomTypeDto {
  @IsString()
  @MaxLength(30)
  name: string;

  @IsInt()
  @IsPositive()
  @Max(45)
  capacity: number;

  @IsNumber()
  @Min(0)
  fee: number;

  @IsInt()
  @IsPositive()
  @Max(500)
  roomCount: number;
}


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

  @IsOptional()
  @IsEnum(CeremonyKind)
  kind?: CeremonyKind;

  @IsOptional()
  @IsInt()
  @IsPositive()
  morningCapacity?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  afternoonCapacity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomTypeDto)
  roomTypes?: RoomTypeDto[];

  /** 進香遊覽車台數 */
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(50)
  busCount?: number;
}
