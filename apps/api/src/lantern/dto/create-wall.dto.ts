import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";

export class CreateWallDto {
  @IsUUID()
  templeId: string;

  @IsString()
  name: string;

  @IsInt()
  @Min(2000)
  year: number;

  @IsNumber()
  @IsPositive()
  slotPrice: number;

  @IsOptional()
  @IsBoolean()
  isTaisuiWall?: boolean;
}

export class UpdateWallDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  isTaisuiWall?: boolean;
}

export class SlotPositionDto {
  @IsInt()
  @IsPositive()
  row: number;

  @IsInt()
  @IsPositive()
  column: number;
}

export class GenerateSlotsDto {
  @IsString()
  prefix: string; // 例如 "A"

  // 使用者在燈牆形狀畫布上點選/拖曳選取的每個燈位座標（排號、排內第幾個），可以是不規則形狀
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SlotPositionDto)
  positions: SlotPositionDto[];
}
