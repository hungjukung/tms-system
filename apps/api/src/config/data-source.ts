import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "../auth/entities/user.entity";
import { Household } from "../household/entities/household.entity";
import { Member } from "../household/entities/member.entity";
import { LanternWall } from "../lantern/entities/lantern-wall.entity";
import { LanternSlot } from "../lantern/entities/lantern-slot.entity";
import { LanternClaim } from "../lantern/entities/lantern-claim.entity";
import { Donation } from "../lantern/entities/donation.entity";
import { Receipt } from "../lantern/entities/receipt.entity";
import { ReceiptAuditLog } from "../lantern/entities/receipt-audit-log.entity";
import { LedgerEntry } from "../finance/entities/ledger-entry.entity";
import { DailyAuditLog } from "../finance/entities/daily-audit-log.entity";
import { Ceremony } from "../ceremony/entities/ceremony.entity";
import { CeremonyRegistration } from "../ceremony/entities/ceremony-registration.entity";
import { InventoryItem } from "../inventory/entities/inventory-item.entity";
import { InventoryTransaction } from "../inventory/entities/inventory-transaction.entity";
import { Temple } from "../settings/entities/temple.entity";
import { Gift } from "../gift/entities/gift.entity";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USER ?? "tms",
  password: process.env.DB_PASSWORD ?? "tms_dev_password",
  database: process.env.DB_NAME ?? "tms",
  synchronize: process.env.DB_SYNCHRONIZE === "true",
  logging: false,
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
  migrations: ["src/migrations/*.ts"],
});
