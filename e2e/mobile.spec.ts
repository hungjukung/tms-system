import { expect, Page, test } from "@playwright/test";
import { apiAs, fillSharedWalkIn, futureDate, login, radioButton, selectOption } from "./helpers";

/**
 * 手機尺寸（iPhone 13／14 一般大小，390×844）：志工常用手機或平板報名。
 * 確認頁面不會左右超出、選單收進抽屜、報名流程走得完、送出按鈕固定在畫面底部。
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** 手機版：登入後從右上角選單抽屜選廟別 */
async function loginWithTempleOnPhone(page: Page, username: string) {
  await login(page, username);
  await page.getByRole("button", { name: "開啟選單" }).click();
  const drawer = page.locator(".ant-drawer-content");
  await expect(drawer.getByRole("button", { name: /登\s*出/ })).toBeVisible();
  await drawer.locator(".ant-select").click();
  await page.locator(".ant-select-item-option", { hasText: "中埔" }).click();
  await page.locator(".ant-drawer-close").click();
}

async function goTo(page: Page, menu: string) {
  await page.getByRole("button", { name: "開啟選單" }).click();
  await page.locator(".ant-drawer-content .ant-menu").getByText(menu, { exact: true }).click();
}

/** 整個頁面不能比螢幕寬（表格太寬時只在表格裡面左右滑動） */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("手機版", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      window.print = () => undefined;
    });
  });

  test("頂部只留頁面名稱與選單按鈕；從抽屜切換頁面；各頁面都不會左右超出畫面", async ({ page }) => {
    await loginWithTempleOnPhone(page, "director");
    await expect(page.locator(".ant-layout-header")).toContainText("活動報名");
    await expect(page.locator(".ant-layout-header .ant-menu")).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    for (const menu of ["信徒管理", "財務管理", "建立活動", "操作紀錄", "活動報名"]) {
      await goTo(page, menu);
      await expect(page.locator(".ant-layout-header")).toContainText(menu);
      await expectNoHorizontalScroll(page);
    }
  });

  test("在手機上完成一筆活動報名：單選按鈕不超出畫面，送出按鈕固定在畫面底部", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `手機報名-${Date.now()}`;
    await api.post("/ceremony/ceremonies", { templeId: await api.templeId(), name, date: futureDate(), feeMode: "FREE_WILL" });

    await loginWithTempleOnPhone(page, "volunteer");
    await page.locator(".ant-checkbox-wrapper", { hasText: "活動報名" }).click();
    await selectOption(page, "選擇活動", name);
    await fillSharedWalkIn(page, "手機測試");
    await page.getByRole("spinbutton", { name: "金額" }).fill("300");
    await expectNoHorizontalScroll(page);

    // 報名者類型的每個按鈕都在畫面內
    for (const box of await page.locator("label.ant-radio-button-wrapper").evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().right),
    )) {
      expect(box).toBeLessThanOrEqual(390);
    }

    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（手機測試）`)).toBeVisible();

    // 送出列固定在畫面底部：捲到最上面時仍然看得到「送出並開立收據」
    await page.evaluate(() => window.scrollTo(0, 0));
    const submit = page.getByRole("button", { name: "送出並開立收據" });
    await expect(submit).toBeInViewport();
    const popupPromise = page.waitForEvent("popup");
    await submit.click();
    const receipt = await popupPromise;
    await expect(page.getByText("已開立收據")).toBeVisible();
    await expect(receipt.locator("body")).toContainText("手機測試");
  });
});
