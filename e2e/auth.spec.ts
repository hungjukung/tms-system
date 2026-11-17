import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** E2E：登入、登出與依角色顯示的選單（從使用者在瀏覽器看到的畫面驗證） */
test.describe("登入與權限", () => {
  test("沒登入直接開網址會被帶到登入頁", async ({ page }) => {
    await page.goto("/finance");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("宮廟管理系統")).toBeVisible();
  });

  /** 回歸測試：登入失敗的 401 曾經觸發整頁重新載入，把錯誤訊息洗掉，使用者只看到畫面閃一下 */
  test("密碼錯誤：停在登入頁並顯示錯誤訊息", async ({ page }) => {
    await login(page, "director", "wrong-password");
    await expect(page.getByText("帳號或密碼錯誤，請重新輸入")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("密碼錯誤：不會登入進系統", async ({ page }) => {
    await login(page, "director", "wrong-password");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /登\s*入/ })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("tms_token"))).toBeNull();
  });

  test("沒填帳號密碼：顯示必填提示，不會送出", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /登\s*入/ }).click();
    await expect(page.getByText("請輸入帳號")).toBeVisible();
    await expect(page.getByText("請輸入密碼")).toBeVisible();
  });

  test("總幹事登入後看得到全部選單，登出後回到登入頁", async ({ page }) => {
    await login(page, "director");
    const menu = page.locator(".ant-menu");
    for (const item of ["活動報名", "信徒管理", "財務管理", "物資庫存", "建立活動", "系統設定"]) {
      await expect(menu.getByText(item, { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: /登\s*出/ }).click();
    await expect(page).toHaveURL(/\/login$/);
    // 登出後不能用上一頁回到系統裡
    await page.goto("/households");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("志工看不到「建立活動」與「系統設定」", async ({ page }) => {
    await login(page, "volunteer");
    const menu = page.locator(".ant-menu");
    await expect(menu.getByText("活動報名", { exact: true })).toBeVisible();
    await expect(menu.getByText("建立活動", { exact: true })).toHaveCount(0);
    await expect(menu.getByText("系統設定", { exact: true })).toHaveCount(0);
  });

  test("資料建檔人員只看得到「信徒管理」", async ({ page }) => {
    await login(page, "dataentry");
    const menu = page.locator(".ant-menu");
    await expect(menu.getByText("信徒管理", { exact: true })).toBeVisible();
    for (const item of ["活動報名", "財務管理", "物資庫存", "建立活動", "系統設定"]) {
      await expect(menu.getByText(item, { exact: true })).toHaveCount(0);
    }
  });
});
