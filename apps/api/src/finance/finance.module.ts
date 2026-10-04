import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LedgerEntry } from "./entities/ledger-entry.entity";
import { DailyAuditLog } from "./entities/daily-audit-log.entity";
import { User } from "../auth/entities/user.entity";
import { Temple } from "../settings/entities/temple.entity";
import { LanternModule } from "../lantern/lantern.module";
import { FinanceService } from "./finance.service";
import { FinanceController } from "./finance.controller";

@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry, DailyAuditLog, User, Temple]), LanternModule],
  providers: [FinanceService],
  controllers: [FinanceController],
})
export class FinanceModule {}
