import { Module } from "@nestjs/common";
import { LanternModule } from "../lantern/lantern.module";
import { CeremonyModule } from "../ceremony/ceremony.module";
import { GiftModule } from "../gift/gift.module";
import { ActivitiesService } from "./activities.service";
import { ActivitiesController } from "./activities.controller";

@Module({
  imports: [LanternModule, CeremonyModule, GiftModule],
  providers: [ActivitiesService],
  controllers: [ActivitiesController],
})
export class ActivitiesModule {}
