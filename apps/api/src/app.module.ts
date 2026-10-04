import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import { HouseholdModule } from "./household/household.module";
import { LanternModule } from "./lantern/lantern.module";
import { PrintModule } from "./print/print.module";
import { FinanceModule } from "./finance/finance.module";
import { CeremonyModule } from "./ceremony/ceremony.module";
import { InventoryModule } from "./inventory/inventory.module";
import { SettingsModule } from "./settings/settings.module";
import { MemberAdminModule } from "./household/member-admin.module";
import { ActivitiesModule } from "./activities/activities.module";
import { GiftModule } from "./gift/gift.module";
import { Gift } from "./gift/entities/gift.entity";
import { User } from "./auth/entities/user.entity";
import { Household } from "./household/entities/household.entity";
import { Member } from "./household/entities/member.entity";
import { LanternWall } from "./lantern/entities/lantern-wall.entity";
import { LanternSlot } from "./lantern/entities/lantern-slot.entity";
import { LanternClaim } from "./lantern/entities/lantern-claim.entity";
import { Donation } from "./lantern/entities/donation.entity";
import { Receipt } from "./lantern/entities/receipt.entity";
import { ReceiptAuditLog } from "./lantern/entities/receipt-audit-log.entity";
import { LedgerEntry } from "./finance/entities/ledger-entry.entity";
import { DailyAuditLog } from "./finance/entities/daily-audit-log.entity";
import { Ceremony } from "./ceremony/entities/ceremony.entity";
import { CeremonyRegistration } from "./ceremony/entities/ceremony-registration.entity";
import { InventoryItem } from "./inventory/entities/inventory-item.entity";
import { InventoryTransaction } from "./inventory/entities/inventory-transaction.entity";
import { Temple } from "./settings/entities/temple.entity";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.get("DB_HOST", "localhost"),
        port: Number(config.get("DB_PORT", 5433)),
        username: config.get("DB_USER", "tms"),
        password: config.get("DB_PASSWORD", "tms_dev_password"),
        database: config.get("DB_NAME", "tms"),
        synchronize: config.get("DB_SYNCHRONIZE", "true") === "true",
        entities: [
          User,
          Household,
          Member,
          LanternWall,
          LanternSlot,
          LanternClaim,
          Donation,
          Receipt,
          ReceiptAuditLog,
          LedgerEntry,
          DailyAuditLog,
          Ceremony,
          CeremonyRegistration,
          InventoryItem,
          InventoryTransaction,
          Temple,
          Gift,
        ],
      }),
    }),
    AuthModule,
    HouseholdModule,
    LanternModule,
    PrintModule,
    FinanceModule,
    CeremonyModule,
    InventoryModule,
    SettingsModule,
    MemberAdminModule,
    ActivitiesModule,
    GiftModule,
  ],
})
export class AppModule {}
