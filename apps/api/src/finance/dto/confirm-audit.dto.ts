import { ArrayNotEmpty, IsArray, IsDateString, IsUUID } from "class-validator";

export class ConfirmAuditDto {
  @IsUUID()
  templeId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsDateString({}, { each: true })
  dates: string[];
}
