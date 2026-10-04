import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Household } from "./entities/household.entity";
import { Member } from "./entities/member.entity";
import { HouseholdService } from "./household.service";
import { HouseholdController } from "./household.controller";
import { LunarService } from "./lunar.service";

@Module({
  imports: [TypeOrmModule.forFeature([Household, Member])],
  providers: [HouseholdService, LunarService],
  controllers: [HouseholdController],
  exports: [HouseholdService, LunarService],
})
export class HouseholdModule {}
