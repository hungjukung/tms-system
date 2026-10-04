import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Ceremony } from "./entities/ceremony.entity";
import { CeremonyRegistration } from "./entities/ceremony-registration.entity";
import { User } from "../auth/entities/user.entity";
import { LedgerEntry } from "../finance/entities/ledger-entry.entity";
import { HouseholdModule } from "../household/household.module";
import { LanternModule } from "../lantern/lantern.module";
import { CeremonyService } from "./ceremony.service";
import { CeremonyController } from "./ceremony.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([Ceremony, CeremonyRegistration, User, LedgerEntry]),
    HouseholdModule,
    LanternModule,
  ],
  providers: [CeremonyService],
  controllers: [CeremonyController],
  exports: [CeremonyService],
})
export class CeremonyModule {}
