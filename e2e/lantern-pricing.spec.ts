import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { apiAs, loginWithTemple, radioButton } from "./helpers";

/**
 * 確認點燈表單選的是這面燈牆：頁面載入時預設選第一面燈牆，而測試資料庫裡可能有好幾面，
 * 所以先看目前選到的是不是，不是才打開下拉選單改選。
 */
async function selectWall(page: Page, wallName: string) {
  const combobox = page.getByRole("combobox", { name: "* 燈牆" });
  const current = page.locator(".ant-form-item", { has: combobox }).locator(".ant-select-selection-item");
  await expect(current).toBeVisible();
  if ((await current.textContent())?.includes(wallName)) return;
  await combobox.click({ force: true });
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: wallName }).click();
}

/**
 * E2E：點燈依燈種計價。
 * 一次選多個燈位、每個燈位各點一種燈，金額依燈種自動加總且鎖定；總幹事在系統設定改價格後立刻生效。
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.print = () => undefined;
  });
});

async function createWall(request: Parameters<typeof apiAs>[0], count: number, isTaisuiWall = false) {
  const api = await apiAs(request, "director");
  const templeId = await api.templeId();
  const name = `燈種牆-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const wall = await api.post("/lantern/walls", { templeId, name, year: 2026, isTaisuiWall });
  await api.post(`/lantern/walls/${wall.id}/slots`, {
    prefix: "A",
    positions: Array.from({ length: count }, (_, i) => ({ row: 1, column: i + 1, gridRow: 1, gridColumn: i + 1 })),
  });
  return { api, name, wall };
}

test("一次選 3 個燈位、各點一種燈：金額自動加總且不能改，收據每盞一個項目", async ({ page, request }) => {
  const { name } = await createWall(request, 3);
  await loginWithTemple(page, "volunteer");
  await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
  await page.locator(".ant-checkbox-wrapper", { hasText: "點燈" }).click();
  const card = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^點燈$/ }) });

  await radioButton(card, "臨櫃香客（免建檔）").click();
  await card.getByLabel("姓名", { exact: true }).fill("龔忠欣");
  await selectWall(page, name);

  // 燈牆不再顯示每盞價格；金額欄是鎖定的
  await expect(page.locator(".ant-select-selection-item", { hasText: name })).not.toContainText("NT$");
  await expect(card.getByRole("spinbutton", { name: /金額/ })).toBeDisabled();

  // 一次選 3 個燈位
  await card.getByRole("button", { name: "選擇燈位" }).click();
  const modal = page.locator(".ant-modal", { hasText: `選擇燈位：${name}` });
  for (const code of ["A-01", "A-02", "A-03"]) await modal.locator(".slot-cell", { hasText: code }).click();
  await modal.getByRole("button", { name: /確認選位/ }).click();

  // 還沒選燈種不能加入
  const add = card.getByRole("button", { name: "加入本次點燈項目" });
  await expect(add).toBeDisabled();

  // 每個燈位各選一種燈種
  const typeSelects = card.locator(".ant-select").filter({ hasText: "請選擇燈種" });
  // 下拉選項可能被畫面下緣遮住，改直接觸發選項的點擊事件（不依賴捲動位置）
  const pick = async (index: number, type: string) => {
    // 每個燈位是一列（標籤＋下拉）；用「剛好只含這個燈位標籤」的那一列，避免比對到包住全部燈位的外層容器
    await card.locator(".ant-space-align-center", { has: page.locator(".ant-tag", { hasText: new RegExp(`^A-0${index + 1}$`) }) }).locator(".ant-select").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: type }).first().dispatchEvent("click");
    // 等這個下拉面板完全關閉再選下一個：否則 :visible 會抓到還在淡出的舊面板，把選項套到上一個燈位
    await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  };
  await expect(typeSelects).toHaveCount(3);
  await pick(0, "平安燈(大)");
  await pick(1, "光明燈");
  await expect(add).toBeDisabled(); // 還有一盞沒選
  await pick(2, "太歲燈");

  // 金額 = 5000 + 600 + 500
  await expect(card.getByRole("spinbutton", { name: /金額/ })).toHaveValue("6100");
  await expect(card.getByText("A-01 平安燈(大) 5000＋A-02 光明燈 600＋A-03 太歲燈 500")).toBeVisible();
  await add.click();

  await expect(page.getByText("龔忠欣　A-01").first()).toBeVisible();
  await expect(page.getByText("NT$ 6,100")).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "送出並開立收據" }).click();
  const receipt = await popupPromise;
  await expect(page.getByText("已開立收據")).toBeVisible();
  const body = receipt.locator("body");
  await expect(body).toContainText("NT$ 6,100");
  for (const part of ["平安燈(大)", "光明燈", "太歲燈", "燈位：A-01", "燈位：A-02", "燈位：A-03"]) await expect(body).toContainText(part);
});

test("太歲燈牆：燈種自動帶入且不能改，金額是太歲燈的價格", async ({ page, request }) => {
  const { name } = await createWall(request, 1, true);
  await loginWithTemple(page, "volunteer");
  await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
  await page.locator(".ant-checkbox-wrapper", { hasText: "點燈" }).click();
  const card = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^點燈$/ }) });
  await radioButton(card, "臨櫃香客（免建檔）").click();
  await card.getByLabel("姓名", { exact: true }).fill("甲");
  await selectWall(page, name);
  await card.getByRole("button", { name: "選擇燈位" }).click();
  await page.locator(".ant-modal", { hasText: `選擇燈位：${name}` }).locator(".slot-cell", { hasText: "A-01" }).click();
  await page.locator(".ant-modal", { hasText: `選擇燈位：${name}` }).getByRole("button", { name: /確認選位/ }).click();

  await expect(card.locator(".ant-space-align-center", { has: page.locator(".ant-tag", { hasText: /^A-01$/ }) }).locator(".ant-select-selection-item")).toContainText("太歲燈");
  await expect(card.getByRole("spinbutton", { name: /金額/ })).toHaveValue("500");
  await expect(card.getByRole("button", { name: "加入本次點燈項目" })).toBeEnabled();
});

test("總幹事在系統設定修改燈種價格：儲存後報名頁立刻用新價格，後端也只收新價格", async ({ page, request }) => {
  const { api, name, wall } = await createWall(request, 1);
  const templeId = await api.templeId();
  const original = await api.get(`/lantern/types?templeId=${templeId}`);

  try {
    await loginWithTemple(page, "director");
    await page.locator(".ant-menu").getByText("系統設定", { exact: true }).click();
    const card = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: "點燈燈種與價格" }) });
    await expect(card.locator("input[placeholder='燈種，例如：光明燈']")).toHaveCount(6);

    // 光明燈改成 700、新增「文昌燈」800
    const lightIndex = await card.locator("input[placeholder='燈種，例如：光明燈']").evaluateAll(
      (els) => els.findIndex((el) => (el as HTMLInputElement).value === "光明燈"),
    );
    await card.locator(`#lanternPrices_lanternTypes_${lightIndex}_price`).fill("700");
    await card.getByRole("button", { name: /新增燈種/ }).click();
    await card.locator("input[placeholder='燈種，例如：光明燈']").last().fill("文昌燈");
    await card.getByPlaceholder("價格").last().fill("800");
    await card.getByRole("button", { name: "儲存燈種與價格" }).click();
    await expect(page.getByText("已儲存燈種與價格")).toBeVisible();

    const updated = await api.get(`/lantern/types?templeId=${templeId}`);
    expect(updated.find((t: { name: string }) => t.name === "光明燈").price).toBe(700);
    expect(updated.find((t: { name: string }) => t.name === "文昌燈").price).toBe(800);

    // 沒保留太歲燈：前端先擋下，不會送出
    const taisuiIndex = await card.locator("input[placeholder='燈種，例如：光明燈']").evaluateAll(
      (els) => els.findIndex((el) => (el as HTMLInputElement).value === "太歲燈"),
    );
    await card.getByRole("button", { name: /刪\s?除/ }).nth(taisuiIndex).click();
    await card.getByRole("button", { name: "儲存燈種與價格" }).click();
    await expect(card.getByText("一定要保留「太歲燈」")).toBeVisible();

    // 報名頁：用新價格計價
    await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
    await page.locator(".ant-checkbox-wrapper", { hasText: "點燈" }).click();
    const lantern = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /^點燈$/ }) });
    await radioButton(lantern, "臨櫃香客（免建檔）").click();
    await lantern.getByLabel("姓名", { exact: true }).fill("甲");
    await selectWall(page, name);
    await lantern.getByRole("button", { name: "選擇燈位" }).click();
    const modal = page.locator(".ant-modal", { hasText: `選擇燈位：${name}` });
    await modal.locator(".slot-cell", { hasText: "A-01" }).click();
    await modal.getByRole("button", { name: /確認選位/ }).click();
    await lantern.locator(".ant-space-align-center", { has: page.locator(".ant-tag", { hasText: /^A-01$/ }) }).locator(".ant-select").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "文昌燈" }).click();
    await expect(lantern.getByRole("spinbutton", { name: /金額/ })).toHaveValue("800");

    // 後端：舊價格被拒絕、新價格通過
    const slots = await api.get(`/lantern/walls/${wall.id}/slots`);
    const res = await request.post("http://localhost:3101/api/lantern/claims", {
      headers: { Authorization: `Bearer ${await tokenOf(request)}` },
      data: { slotId: slots[0].id, lanternType: "光明燈", walkInName: "乙", amount: 600 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toBe("光明燈每盞 NT$ 700，金額不正確");
  } finally {
    // 還原成原本的價格，不影響後面的測試
    const token = await tokenOf(request);
    await request.put(`http://localhost:3101/api/settings/${templeId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { lanternTypes: original },
    });
  }
});

async function tokenOf(request: Parameters<typeof apiAs>[0]) {
  const res = await request.post("http://localhost:3101/api/auth/login", { data: { username: "director", password: "pass1234" } });
  return (await res.json()).accessToken as string;
}
