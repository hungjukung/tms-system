import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { DataSource } from "typeorm";
import { UserRole } from "@tms/shared";
import { AppModule } from "../../src/app.module";
import { User } from "../../src/auth/entities/user.entity";
import { Temple } from "../../src/settings/entities/temple.entity";

/** 整合測試共用密碼（符合登入 DTO 至少 4 碼的規定） */
export const TEST_PASSWORD = "pass1234";

/**
 * 保險絲：整合測試只准連到本機的測試專用資料庫。
 * 萬一環境變數被設成別的主機（例如正式環境的 Cloud SQL），直接讓測試失敗，不會動到任何真實資料。
 */
function assertTestDatabase(): void {
  const { DB_HOST, DB_NAME, DB_PORT } = process.env;
  if (DB_HOST !== "127.0.0.1" || DB_NAME !== "tms_test" || DB_PORT === "5432" || DB_PORT === "5433") {
    throw new Error(`拒絕執行：整合測試只能連測試專用資料庫，目前設定是 ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  }
}

/** 啟動完整的 Nest 應用程式（設定比照 src/main.ts：/api 前綴 + 全域 ValidationPipe），接上測試資料庫 */
export async function createTestApp(): Promise<INestApplication> {
  assertTestDatabase();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

/** 清空所有資料表，讓每個測試檔（或每個測試）從乾淨的資料庫開始 */
export async function resetDatabase(app: INestApplication): Promise<void> {
  assertTestDatabase();
  const dataSource = app.get(DataSource);
  const tables = dataSource.entityMetadatas.map((m) => `"${m.tableName}"`).join(", ");
  await dataSource.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

export type RoleTokens = Record<UserRole, string>;

export interface BaseFixture {
  templeId: string;
  /** 每個角色各一個帳號（帳號名稱是角色的小寫，例如 director），值是登入後的 JWT */
  tokens: RoleTokens;
  userIds: Record<UserRole, string>;
}

/** 建立一間廟宇與每個角色各一個帳號，並實際呼叫登入 API 取得 token */
export async function seedBaseFixture(app: INestApplication): Promise<BaseFixture> {
  const dataSource = app.get(DataSource);
  const temple = await dataSource.getRepository(Temple).save({ name: "中埔", templeName: "測試宮" });
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const tokens = {} as RoleTokens;
  const userIds = {} as Record<UserRole, string>;
  for (const role of Object.values(UserRole)) {
    const username = role.toLowerCase();
    const user = await dataSource
      .getRepository(User)
      .save({ username, passwordHash, displayName: `測試-${role}`, role, active: true });
    userIds[role] = user.id;
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ username, password: TEST_PASSWORD })
      .expect(201);
    tokens[role] = res.body.accessToken;
  }
  return { templeId: temple.id, tokens, userIds };
}

/** 帶好 /api 前綴與 Authorization header 的 HTTP 用戶端 */
export function api(app: INestApplication, token?: string) {
  const server = app.getHttpServer();
  const withAuth = (req: request.Test) => (token ? req.set("Authorization", `Bearer ${token}`) : req);
  return {
    get: (path: string) => withAuth(request(server).get(`/api${path}`)),
    post: (path: string, body?: object) => withAuth(request(server).post(`/api${path}`)).send(body ?? {}),
    patch: (path: string, body?: object) => withAuth(request(server).patch(`/api${path}`)).send(body ?? {}),
    put: (path: string, body?: object) => withAuth(request(server).put(`/api${path}`)).send(body ?? {}),
    delete: (path: string) => withAuth(request(server).delete(`/api${path}`)),
  };
}

/** 常用的建檔小工具：新增一位信徒（戶籍地址相同會自動歸到同一戶），回傳信徒資料 */
export async function createMember(
  app: INestApplication,
  token: string,
  name: string,
  householdAddress = `${name}的家`,
): Promise<{ id: string; name: string; householdId: string }> {
  const res = await api(app, token)
    .post("/members", { householdAddress, name, gender: "UNKNOWN" })
    .expect(201);
  return res.body;
}
