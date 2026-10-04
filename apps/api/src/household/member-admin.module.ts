import { Module } from "@nestjs/common";
import { HouseholdModule } from "./household.module";
import { LanternModule } from "../lantern/lantern.module";
import { CeremonyModule } from "../ceremony/ceremony.module";
import { MemberAdminService } from "./member-admin.service";
import { MemberAdminController } from "./member-admin.controller";

/**
 * 組合層模組：需要同時存取 Household、Lantern、Ceremony 三個模組才能判斷信徒是否有歷史紀錄，
 * 刻意獨立於 HouseholdModule 之外，避免造成 HouseholdModule ↔ Lantern/CeremonyModule 循環依賴。
 */
@Module({
  imports: [HouseholdModule, LanternModule, CeremonyModule],
  providers: [MemberAdminService],
  controllers: [MemberAdminController],
})
export class MemberAdminModule {}
