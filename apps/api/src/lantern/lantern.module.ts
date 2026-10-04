import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LanternWall } from "./entities/lantern-wall.entity";
import { LanternSlot } from "./entities/lantern-slot.entity";
import { LanternClaim } from "./entities/lantern-claim.entity";
import { Donation } from "./entities/donation.entity";
import { Receipt } from "./entities/receipt.entity";
import { ReceiptAuditLog } from "./entities/receipt-audit-log.entity";
import { User } from "../auth/entities/user.entity";
import { Ceremony } from "../ceremony/entities/ceremony.entity";
import { CeremonyRegistration } from "../ceremony/entities/ceremony-registration.entity";
import { Gift } from "../gift/entities/gift.entity";
import { HouseholdModule } from "../household/household.module";
import { LanternService } from "./lantern.service";
import { LanternController } from "./lantern.controller";
import { LanternGateway } from "./lantern.gateway";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LanternWall,
      LanternSlot,
      LanternClaim,
      Donation,
      Receipt,
      ReceiptAuditLog,
      User,
      Ceremony,
      CeremonyRegistration,
      Gift,
    ]),
    HouseholdModule,
  ],
  providers: [LanternService, LanternGateway],
  controllers: [LanternController],
  exports: [LanternService],
})
export class LanternModule {}
