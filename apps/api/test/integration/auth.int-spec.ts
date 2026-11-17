import { INestApplication } from "@nestjs/common";
import { UserRole } from "@tms/shared";
import { api, BaseFixture, createTestApp, resetDatabase, seedBaseFixture, TEST_PASSWORD } from "../support/app";

/**
 * 黑箱測試：登入與帳號管理 API。
 * 只從對外的 HTTP 介面驗證，測試案例用等價分割與邊界值設計（例如密碼長度 3 碼 / 4 碼）。
 */
describe("登入與帳號管理（黑箱／HTTP API）", () => {
  let app: INestApplication;
  let fx: BaseFixture;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fx = await seedBaseFixture(app);
  });
  afterAll(async () => {
    await app.close();
  });

  describe("POST /auth/login", () => {
    it("帳號密碼正確：回傳 token 與使用者資料（不含密碼）", async () => {
      const res = await api(app).post("/auth/login", { username: "director", password: TEST_PASSWORD }).expect(201);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toEqual({
        id: fx.userIds[UserRole.DIRECTOR],
        username: "director",
        displayName: "測試-DIRECTOR",
        role: UserRole.DIRECTOR,
      });
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    });

    it("密碼錯誤：401", async () => {
      const res = await api(app).post("/auth/login", { username: "director", password: "wrong-password" }).expect(401);
      expect(res.body.message).toBe("帳號或密碼錯誤");
    });

    it("帳號不存在：401，訊息與密碼錯誤相同（不洩漏帳號是否存在）", async () => {
      const res = await api(app).post("/auth/login", { username: "nobody", password: TEST_PASSWORD }).expect(401);
      expect(res.body.message).toBe("帳號或密碼錯誤");
    });

    it("邊界值：密碼 3 碼被格式驗證擋下（400），4 碼才會進到帳密比對（401）", async () => {
      await api(app).post("/auth/login", { username: "director", password: "abc" }).expect(400);
      await api(app).post("/auth/login", { username: "director", password: "abcd" }).expect(401);
    });

    it("缺少欄位：400", async () => {
      await api(app).post("/auth/login", { username: "director" }).expect(400);
      await api(app).post("/auth/login", {}).expect(400);
    });

    it("已停用的帳號無法登入，原本的 token 也立即失效", async () => {
      const director = api(app, fx.tokens[UserRole.DIRECTOR]);
      await director.patch(`/auth/users/${fx.userIds[UserRole.VOLUNTEER]}`, { active: false }).expect(200);

      await api(app).post("/auth/login", { username: "volunteer", password: TEST_PASSWORD }).expect(401);
      await api(app, fx.tokens[UserRole.VOLUNTEER]).get("/temples").expect(401);
    });
  });

  describe("未登入／token 不合法", () => {
    it("沒帶 token：401", async () => {
      await api(app).get("/temples").expect(401);
    });
    it("亂寫的 token：401", async () => {
      await api(app, "not-a-real-token").get("/temples").expect(401);
    });
  });

  describe("帳號管理 /auth/users（僅總幹事）", () => {
    it("總幹事可以列出、新增帳號；新帳號可以登入", async () => {
      const director = api(app, fx.tokens[UserRole.DIRECTOR]);
      const list = await director.get("/auth/users").expect(200);
      expect(list.body).toHaveLength(Object.values(UserRole).length);

      const created = await director
        .post("/auth/users", { username: "newbie", password: "abcd", displayName: "新人", role: UserRole.VOLUNTEER })
        .expect(201);
      expect(created.body).toMatchObject({ username: "newbie", role: UserRole.VOLUNTEER, active: true });

      await api(app).post("/auth/login", { username: "newbie", password: "abcd" }).expect(201);
    });

    it("帳號名稱重複：409", async () => {
      const res = await api(app, fx.tokens[UserRole.DIRECTOR])
        .post("/auth/users", { username: "finance", password: "abcd", displayName: "重複", role: UserRole.FINANCE })
        .expect(409);
      expect(res.body.message).toBe("此帳號已被使用，請換一個帳號名稱");
    });

    it("邊界值：帳號至少 2 碼、密碼至少 4 碼、角色必須是合法值", async () => {
      const director = api(app, fx.tokens[UserRole.DIRECTOR]);
      const valid = { username: "ab", password: "abcd", displayName: "x", role: UserRole.VOLUNTEER };
      await director.post("/auth/users", { ...valid, username: "a" }).expect(400);
      await director.post("/auth/users", { ...valid, password: "abc" }).expect(400);
      await director.post("/auth/users", { ...valid, role: "SUPERUSER" }).expect(400);
      await director.post("/auth/users", valid).expect(201);
    });

    it.each([UserRole.FINANCE, UserRole.VOLUNTEER, UserRole.REGISTRAR, UserRole.DATA_ENTRY])(
      "%s 不能管理帳號：403",
      async (role) => {
        await api(app, fx.tokens[role]).get("/auth/users").expect(403);
      },
    );

    it("總幹事不能把自己降級、停用或刪除（避免把自己鎖在系統外）", async () => {
      const director = api(app, fx.tokens[UserRole.DIRECTOR]);
      const me = fx.userIds[UserRole.DIRECTOR];
      await director.patch(`/auth/users/${me}`, { role: UserRole.VOLUNTEER }).expect(403);
      await director.patch(`/auth/users/${me}`, { active: false }).expect(403);
      await director.delete(`/auth/users/${me}`).expect(403);
      // 改自己的顯示名稱不受限制
      await director.patch(`/auth/users/${me}`, { displayName: "王總幹事" }).expect(200);
    });

    it("重設密碼後舊密碼失效、新密碼可登入", async () => {
      await api(app, fx.tokens[UserRole.DIRECTOR])
        .post(`/auth/users/${fx.userIds[UserRole.FINANCE]}/reset-password`, { password: "newpass" })
        .expect(201);
      await api(app).post("/auth/login", { username: "finance", password: TEST_PASSWORD }).expect(401);
      await api(app).post("/auth/login", { username: "finance", password: "newpass" }).expect(201);
    });
  });

  describe("使用者自己的帳號 /auth/me", () => {
    it("變更密碼需要目前密碼正確", async () => {
      const volunteer = api(app, fx.tokens[UserRole.VOLUNTEER]);
      await volunteer.post("/auth/me/change-password", { currentPassword: "wrong", newPassword: "newpass" }).expect(401);
      await volunteer
        .post("/auth/me/change-password", { currentPassword: TEST_PASSWORD, newPassword: "newpass" })
        .expect(201);
      await api(app).post("/auth/login", { username: "volunteer", password: "newpass" }).expect(201);
    });

    it("可以改自己的顯示名稱；改成別人已用的帳號名稱：409", async () => {
      const volunteer = api(app, fx.tokens[UserRole.VOLUNTEER]);
      const res = await volunteer.patch("/auth/me", { displayName: "陳志工" }).expect(200);
      expect(res.body.displayName).toBe("陳志工");
      await volunteer.patch("/auth/me", { username: "finance" }).expect(409);
    });
  });
});
