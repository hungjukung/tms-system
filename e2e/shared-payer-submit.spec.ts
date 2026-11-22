import { expect, test } from "@playwright/test";
import { apiAs, loginWithTemple, payerCard } from "./helpers";

/**
 * 防回歸：沒勾選「多人報名」時，報名者只在最上方填一次（各區塊自己的報名者欄位是隱藏、自動同步的）。
 * 曾經因為「送出前檢查有沒有填了沒加入的內容」把這些被同步的隱藏欄位也算進去，
 * 結果加入一筆捐款之後按「送出並開立收據」完全沒反應。
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.print = () => undefined;
  });
});

test("共用報名者是已建檔信徒：加入捐款後可以直接送出；再加一筆也能送出，兩筆都開在同一張收據", async ({ page, request }) => {
  const api = await apiAs(request, "director");
  await api.post("/members", { householdAddress: "測試路1號", name: "瑞恩教育科技有限公司", gender: "UNKNOWN" });

  await loginWithTemple(page, "volunteer");
  await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
  await page.locator(".ant-checkbox-wrapper", { hasText: "捐款收費" }).click();

  // 最上方選報名者（已建檔信徒）
  await payerCard(page).locator("input.ant-select-selection-search-input").fill("瑞恩");
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "瑞恩教育科技有限公司" }).click();

  const donation = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^捐款收費$/ }) });
  const addDonation = async (type: string, amount: string) => {
    await donation.getByRole("combobox", { name: /項目/ }).click({ force: true });
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: type }).dispatchEvent("click");
    await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
    await donation.getByRole("spinbutton", { name: /金額/ }).fill(amount);
    await donation.getByRole("button", { name: "加入本次捐款項目" }).click();
  };

  await addDonation("普渡捐款", "500");
  await expect(donation.getByText("本次已加入 1 筆捐款")).toBeVisible();
  await addDonation("修繕捐款", "300");
  await expect(donation.getByText("本次已加入 2 筆捐款")).toBeVisible();
  await expect(page.getByText("NT$ 800").first()).toBeVisible();

  // 直接送出：不會被「還有沒加入的內容」誤擋
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "送出並開立收據" }).click();
  const receipt = await popupPromise;
  await expect(page.getByText("已開立收據")).toBeVisible();
  const body = receipt.locator("body");
  await expect(body).toContainText("瑞恩教育科技有限公司");
  await expect(body).toContainText("NT$ 800");
  await expect(body).toContainText("普渡捐款");
  await expect(body).toContainText("修繕捐款");
});

test("金額還留在表單上、沒按「加入」就送出：會提醒，不會悄悄漏掉", async ({ page }) => {
  await loginWithTemple(page, "volunteer");
  await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
  await page.locator(".ant-checkbox-wrapper", { hasText: "捐款收費" }).click();
  await payerCard(page).locator("label.ant-radio-button-wrapper", { hasText: "臨櫃香客" }).click();
  await payerCard(page).getByPlaceholder("報名者姓名").fill("甲");
  const donation = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^捐款收費$/ }) });
  await donation.getByRole("spinbutton", { name: /金額/ }).fill("500");
  await donation.getByRole("button", { name: "加入本次捐款項目" }).click();
  await expect(donation.getByText("本次已加入 1 筆捐款")).toBeVisible();

  // 再填一筆金額但不加入
  await donation.getByRole("spinbutton", { name: /金額/ }).fill("200");
  await page.getByRole("button", { name: "送出並開立收據" }).click();
  await expect(page.getByText("捐款表單上還有填寫但沒有加入的內容")).toBeVisible();
});
