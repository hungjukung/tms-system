import * as fs from "fs";
import * as path from "path";
import { DataSource } from "typeorm";
import { AppDataSource } from "../../src/config/data-source";

const CHECK_DB = "tms_migration_check";

function connection(database: string) {
  return {
    type: "postgres" as const,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
  };
}

/**
 * 正式環境的資料表是靠 migration 建立的（DB_SYNCHRONIZE=false），其他整合測試則是靠 entity 自動同步建表。
 * 這個測試確認兩邊一致：從空資料庫跑完所有 migration 之後，資料表結構必須跟 entity 定義完全相同，
 * 否則就代表「改了 entity 卻忘了寫 migration」（部署後正式環境會壞掉）或 migration 寫錯。
 */
/**
 * 已知、既有的差異（黑箱測試建立前就存在，不影響目前功能，列在這裡避免蓋掉新的問題）：
 *  1. receipts.sourceType 的 enum：entity 有 GIFT，但沒有任何 migration 把 GIFT 加進資料庫的 enum。
 *     目前 GIFT 只出現在合併收據 items[].sourceRefs（JSON）裡，不會寫進這個欄位，所以正式環境沒有出錯；
 *     但哪天真的把 GIFT 寫進 receipts.sourceType，正式環境會直接報錯。
 *  2. daily_audit_logs 的唯一約束：migration 取的名字跟 entity 自動產生的名字不同（只是名稱不同，約束內容一樣）。
 */
const KNOWN_DRIFT: RegExp[] = [];

describe("資料庫 migration", () => {
  let dataSource: DataSource;

  const pendingSchemaChanges = async () =>
    (await dataSource.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query);
  const withoutKnownDrift = (queries: string[]) => queries.filter((q) => !KNOWN_DRIFT.some((known) => known.test(q)));

  beforeAll(async () => {
    if (process.env.DB_HOST !== "127.0.0.1") throw new Error("migration 檢查只能在測試專用資料庫上執行");
    const admin = new DataSource(connection("tms_test"));
    await admin.initialize();
    await admin.query(`DROP DATABASE IF EXISTS ${CHECK_DB}`);
    await admin.query(`CREATE DATABASE ${CHECK_DB}`);
    await admin.destroy();

    const migrationsDir = path.join(__dirname, "../../src/migrations");
    const migrations = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".ts"))
      .sort()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      .flatMap((file) => Object.values(require(path.join(migrationsDir, file)) as Record<string, new () => unknown>));

    dataSource = new DataSource({
      ...connection(CHECK_DB),
      entities: AppDataSource.options.entities,
      migrations: migrations as never,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it("所有 migration 可以從空資料庫依序跑完", async () => {
    const executed = await dataSource.runMigrations();
    expect(executed.length).toBeGreaterThan(0);
    expect(await dataSource.showMigrations()).toBe(false); // 沒有尚未執行的 migration
  });

  it("跑完 migration 的資料表結構與 entity 定義完全一致（沒有漏寫 migration）", async () => {
    expect(withoutKnownDrift(await pendingSchemaChanges())).toEqual([]);
  });

  it("最新一支 migration 可以還原再重跑（down / up 都正確）", async () => {
    await dataSource.undoLastMigration();
    expect(await dataSource.showMigrations()).toBe(true);
    await dataSource.runMigrations();
    expect(withoutKnownDrift(await pendingSchemaChanges())).toEqual([]);
  });
});
