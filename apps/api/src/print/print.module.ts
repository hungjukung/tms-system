import { Module } from "@nestjs/common";
import { LanternModule } from "../lantern/lantern.module";
import { CeremonyModule } from "../ceremony/ceremony.module";
import { SettingsModule } from "../settings/settings.module";
import { PrintService } from "./print.service";
import { PrintController } from "./print.controller";

@Module({
  imports: [LanternModule, CeremonyModule, SettingsModule],
  providers: [PrintService],
  controllers: [PrintController],
})
export class PrintModule {}
