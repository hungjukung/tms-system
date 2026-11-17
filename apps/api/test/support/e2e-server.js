/**
 * E2E 測試用的後端：啟動一份測試專用的臨時 PostgreSQL，接上「編譯後的」Nest 應用程式（dist/），
 * 建好一間廟宇與幾個測試帳號後開始聽 port。由 Playwright 的 webServer 啟動與關閉。
 * 需要先執行過 pnpm --filter @tms/shared build && pnpm --filter @tms/api build。
 */
require("reflect-metadata");
const path = require("path");
const { startTestDb, applyTestDbEnv } = require("./test-db");

const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
const DB_PORT = Number(process.env.E2E_DB_PORT ?? 54330);
const PASSWORD = "pass1234";

async function main() {
  const db = await startTestDb(DB_PORT);
  applyTestDbEnv(db.config);

  const dist = path.join(__dirname, "../../dist");
  const { NestFactory } = require("@nestjs/core");
  const { ValidationPipe } = require("@nestjs/common");
  const { DataSource } = require("typeorm");
  const bcrypt = require("bcrypt");
  const { AppModule } = require(path.join(dist, "app.module"));
  const { User } = require(path.join(dist, "auth/entities/user.entity"));
  const { Temple } = require(path.join(dist, "settings/entities/temple.entity"));

  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const dataSource = app.get(DataSource);
  await dataSource.getRepository(Temple).save({ name: "中埔", templeName: "E2E測試宮" });
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  for (const [username, displayName, role] of [
    ["director", "王總幹事", "DIRECTOR"],
    ["volunteer", "陳志工", "VOLUNTEER"],
    ["dataentry", "林建檔", "DATA_ENTRY"],
    ["viewer", "參觀者", "VIEWER"],
  ]) {
    await dataSource.getRepository(User).save({ username, displayName, role, passwordHash, active: true });
  }

  await app.listen(API_PORT);
  console.log(`E2E API ready on http://localhost:${API_PORT}`);

  const shutdown = async () => {
    await app.close().catch(() => undefined);
    await db.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
