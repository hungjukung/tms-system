import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class MovePilgrimageBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  roomType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  busNumber?: number;
}

export class DuplicateCheckDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID("all", { each: true })
  memberIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  names?: string[];
}
