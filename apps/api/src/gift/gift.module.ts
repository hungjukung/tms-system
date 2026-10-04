import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HouseholdModule } from "../household/household.module";
import { Gift } from "./entities/gift.entity";
import { GiftService } from "./gift.service";

@Module({
  imports: [TypeOrmModule.forFeature([Gift]), HouseholdModule],
  providers: [GiftService],
  exports: [GiftService],
})
export class GiftModule {}
