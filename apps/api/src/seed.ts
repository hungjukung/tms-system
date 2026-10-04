import "reflect-metadata";
import "dotenv/config";
import * as bcrypt from "bcrypt";
import { DataSource } from "typeorm";
import { UserRole } from "@tms/shared";
import { User } from "./auth/entities/user.entity";
import { LanternWall } from "./lantern/entities/lantern-wall.entity";
import { LanternSlot } from "./lantern/entities/lantern-slot.entity";
import { Household } from "./household/entities/household.entity";
import { Member } from "./household/entities/member.entity";
import { LanternClaim } from "./lantern/entities/lantern-claim.entity";
import { Donation } from "./lantern/entities/donation.entity";
import { Receipt } from "./lantern/entities/receipt.entity";
import { ReceiptAuditLog } from "./lantern/entities/receipt-audit-log.entity";

async function seed() {
  const dataSource = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5433),
    username: process.env.DB_USER ?? "tms",
    password: process.env.DB_PASSWORD ?? "tms_dev_password",
    database: process.env.DB_NAME ?? "tms",
    synchronize: true,
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
    ],
  });
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const seedUsers: Array<{ username: string; password: string; displayName: string; role: UserRole }> = [
    { username: "director", password: "director123", displayName: "王總幹事", role: UserRole.DIRECTOR },
    { username: "finance", password: "finance123", displayName: "李財務", role: UserRole.FINANCE },
    { username: "volunteer", password: "volunteer123", displayName: "陳志工", role: UserRole.VOLUNTEER },
  ];
  for (const u of seedUsers) {
    const exists = await userRepo.findOne({ where: { username: u.username } });
    if (exists) continue;
    const passwordHash = await bcrypt.hash(u.password, 10);
    await userRepo.save(userRepo.create({ ...u, passwordHash }));
    console.log(`建立使用者: ${u.username} / ${u.password}（${u.role}）`);
  }

  const wallRepo = dataSource.getRepository(LanternWall);
  const slotRepo = dataSource.getRepository(LanternSlot);
  const currentYear = new Date().getFullYear();
  let wall = await wallRepo.findOne({ where: { name: "大殿光明燈", year: currentYear } });
  if (!wall) {
    wall = await wallRepo.save(
      wallRepo.create({ name: "大殿光明燈", year: currentYear, slotPrice: "600.00" }),
    );
    const slots = Array.from({ length: 30 }, (_, i) =>
      slotRepo.create({ wallId: wall!.id, code: `A-${String(i + 1).padStart(2, "0")}` }),
    );
    await slotRepo.save(slots);
    console.log(`建立燈牆「大殿光明燈」與 30 個燈位`);
  }

  await dataSource.destroy();
  console.log("Seed 完成");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
