/**
 * 測試專用的臨時 PostgreSQL（embedded-postgres：直接在本機啟動一份真的 PostgreSQL 16，不需要 Docker）。
 * 每次啟動都會清空資料目錄重建，資料只存在作業系統的暫存資料夾；連線固定走 127.0.0.1 的專用埠，
 * 跟開發用（5433）與正式環境（Cloud SQL）完全分開，測試絕對不會碰到真實資料。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

function testDbConfig(port = 54329) {
  return { host: "127.0.0.1", port, user: "tms_test", password: "tms_test", database: "tms_test" };
}

async function startTestDb(port = 54329) {
  const config = testDbConfig(port);
  const databaseDir = path.join(os.tmpdir(), `tms-test-pg-${port}`);
  fs.rmSync(databaseDir, { recursive: true, force: true });
  // embedded-postgres 是 ESM 套件：只在真的要啟動資料庫時才載入，Jest 測試環境內只會用到上面的連線設定
  const EmbeddedPostgres = require("embedded-postgres").default;
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: config.user,
    password: config.password,
    port: config.port,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(config.database);
  return {
    config,
    stop: async () => {
      await pg.stop();
      fs.rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}

/** 把連線設定寫進環境變數；Nest 的 ConfigModule 會優先採用環境變數，蓋過 apps/api/.env 的開發設定 */
function applyTestDbEnv(config, env = process.env) {
  env.DB_HOST = config.host;
  env.DB_PORT = String(config.port);
  env.DB_USER = config.user;
  env.DB_PASSWORD = config.password;
  env.DB_NAME = config.database;
  env.DB_SYNCHRONIZE = "true";
  env.JWT_SECRET = "test-secret";
  delete env.GCS_BUCKET_NAME;
  delete env.CORS_ORIGIN;
  return env;
}

module.exports = { testDbConfig, startTestDb, applyTestDbEnv };
