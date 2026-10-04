import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Temple } from "./entities/temple.entity";
import { SettingsService } from "./settings.service";
import { SettingsController } from "./settings.controller";
import { UploadService } from "./upload.service";

@Module({
  imports: [TypeOrmModule.forFeature([Temple])],
  providers: [SettingsService, UploadService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
