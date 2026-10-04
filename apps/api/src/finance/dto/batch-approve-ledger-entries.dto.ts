import { IsArray, IsUUID } from "class-validator";

export class BatchApproveLedgerEntriesDto {
  @IsArray()
  @IsUUID("4", { each: true })
  ids: string[];
}
