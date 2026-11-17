import { expect, Page, test } from "@playwright/test";
import { apiAs, futureDate, loginWithTemple, radioButton, selectOption } from "./helpers";

/**
 * E2E：從建立活動到報名、開立收據的完整流程，全部用瀏覽器操作畫面完成，
 * 最後再從收據列印視窗與後端資料確認結果。
 */
test.describe("活動建立與報名", () => {
  test.beforeEach(async ({ context }) => {
    // 收據列印視窗一開就會呼叫 window.print()，測試時換成空函式避免卡在列印對話框
    await context.addInitScript(() => {
      window.print = () => undefined;
    });
  });

  /** 在「活動報名」頁勾選「活動報名」並選好活動 */
  async function openCeremonyRegistration(page: Page, ceremonyName: string) {
    await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
    await page.locator(".ant-checkbox-wrapper", { hasText: "活動報名" }).click();
    await selectOption(page, "選擇活動", ceremonyName);
  }

  /** 按「送出並開立收據」，回傳跳出來的收據列印視窗 */
  async function submitAndGetReceipt(page: Page) {
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "送出並開立收據" }).click();
    const popup = await popupPromise;
    await expect(page.getByText("已開立收據")).toBeVisible();
    return popup;
  }

  test("總幹事建立祭改活動 → 志工報名上午場 → 收據印出「王小明，上午場 1號」", async ({ page, request }) => {
    const name = `祭改E2E-${Date.now()}`;

    // 1. 總幹事在「建立活動」頁建立祭改活動，設定上午 2 人、下午 1 人
    await loginWithTemple(page, "director");
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^祭改$/).click();
    await expect(page.getByText("新增祭改活動")).toBeVisible();
    await page.getByLabel("活動名稱").fill(name);
    await page.getByLabel("上午場人數").fill("2");
    await page.getByLabel("下午場人數").fill("1");
    await page.getByRole("button", { name: "建立活動" }).click();

    const row = page.locator(".ant-table-row", { hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("上午 0/2");
    await expect(row).toContainText("下午 0/1");

    // 2. 到「活動報名」頁替臨櫃香客報名上午場
    await openCeremonyRegistration(page, name);
    await radioButton(page, /上午場/).click();
    await radioButton(page, "臨櫃香客（免建檔）").click();
    await page.getByLabel("姓名", { exact: true }).fill("王小明");
    await page.getByRole("spinbutton", { name: "金額" }).fill("300");
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（王小明　上午場）`)).toBeVisible();
    await expect(page.getByText("NT$ 300").first()).toBeVisible();

    // 3. 送出，收據列印視窗上有姓名、金額與場次號碼
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("感謝狀");
    await expect(receipt.locator("body")).toContainText("王小明");
    await expect(receipt.locator("body")).toContainText("NT$ 300");
    await expect(receipt.locator("body")).toContainText("王小明，上午場 1號");
    await expect(receipt.locator("body")).toContainText("E2E測試宮");

    // 4. 後端資料：上午場已報名 1 人
    const api = await apiAs(request, "director");
    const ceremonies = await api.get("/ceremony/ceremonies");
    expect(ceremonies.find((c: { name: string }) => c.name === name)).toMatchObject({ morningRegistered: 1, afternoonRegistered: 0 });
  });

  test("祭改場次額滿後，該場次在報名畫面上不能選", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `祭改額滿-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "JIGAI",
      morningCapacity: 1,
      afternoonCapacity: 1,
    });
    await api.post("/activities/submit", {
      pendingCeremonyRegistrations: [{ ceremonyId: ceremony.id, walkInName: "先來的人", amount: 100, session: "AM" }],
    });

    await loginWithTemple(page, "volunteer");
    await openCeremonyRegistration(page, name);
    await expect(radioButton(page, "上午場（1/1）")).toHaveClass(/ant-radio-button-wrapper-disabled/);
    await expect(radioButton(page, "下午場（0/1）")).not.toHaveClass(/ant-radio-button-wrapper-disabled/);
  });

  test("總幹事在畫面上建立進香活動（遊覽車台數、房型間數）→ 雙人房只報 1 人 → 收據印房型 → 已訂間數更新", async ({ page }) => {
    const name = `進香房型-${Date.now()}`;

    // 1. 建立活動：畫面上沒有收費方式，改設定遊覽車台數與房型（每間人數、費用、間數）
    await loginWithTemple(page, "director");
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^進香$/).click();
    await expect(page.getByText("新增進香活動")).toBeVisible();
    const createCard = page.locator(".ant-card", { hasText: "新增進香活動" });
    await expect(createCard.getByText("收費方式", { exact: true })).toHaveCount(0);
    await page.getByLabel("活動名稱").fill(name);
    await page.getByLabel(/遊覽車台數/).fill("1");
    await page.getByPlaceholder("房型，例如：雙人房").nth(0).fill("雙人房");
    await page.getByPlaceholder("每間人數").nth(0).fill("2");
    await page.getByPlaceholder("費用").nth(0).fill("3000");
    await page.getByPlaceholder("間數").nth(0).fill("2");
    await page.getByRole("button", { name: /新增房型/ }).click();
    await page.getByPlaceholder("房型，例如：雙人房").nth(1).fill("四人房");
    await page.getByPlaceholder("每間人數").nth(1).fill("4");
    await page.getByPlaceholder("費用").nth(1).fill("5200");
    await page.getByPlaceholder("間數").nth(1).fill("1");
    await page.getByRole("button", { name: "建立活動" }).click();

    await expect(page.getByText("已建立活動")).toBeVisible();
    const row = page.locator(".ant-table-row", { hasText: name });
    await expect(row).toContainText("依房型");
    await expect(row).toContainText("遊覽車 0/40 人");
    await expect(row).toContainText("雙人房 0/2 間");

    // 2. 報名：選雙人房，金額帶入房費且不能改；只登錄 1 位也可以；沒有遊覽車選位
    await openCeremonyRegistration(page, name);
    await selectOption(page, "房型", "雙人房（每間最多 2 人，NT$ 3000，剩 2 間）");
    const amount = page.getByRole("spinbutton", { name: "金額" });
    await expect(amount).toHaveValue("3000");
    await expect(amount).toBeDisabled();
    await expect(page.getByText("遊覽車 1 台共 40 位，剩 40 位")).toBeVisible();
    await expect(page.getByRole("button", { name: /選擇遊覽車座位/ })).toHaveCount(0);
    await expect(radioButton(page, "整戶報名")).toHaveCount(0);

    const participant = (n: number) => page.locator(".ant-card-small", { hasText: `參加者 ${n}` });
    await radioButton(participant(1), "臨櫃香客").click();
    await participant(1).getByPlaceholder("姓名").fill("阿土伯");
    await expect(page.getByText("雙人房每間最多 2 人，目前 1 人")).toBeVisible();

    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（雙人房　阿土伯）`)).toBeVisible();

    // 3. 收據：金額是房費，左邊備註印房型
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("阿土伯");
    await expect(receipt.locator("body")).toContainText("NT$ 3,000");
    await expect(receipt.locator("body")).toContainText("雙人房");

    // 4. 已訂間數與遊覽車人數都更新
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^進香$/).click();
    const rowAfter = page.locator(".ant-table-row", { hasText: name });
    await expect(rowAfter).toContainText("遊覽車 1/40 人");
    await expect(rowAfter).toContainText("雙人房 1/2 間");
  });

  test("進香：參加者不能超過房型每間人數；房型訂滿就不能選", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香訂滿-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "PILGRIMAGE",
      busCount: 1,
      roomTypes: [
        { name: "雙人房", capacity: 2, fee: 3000, roomCount: 1 },
        { name: "四人房", capacity: 4, fee: 5200, roomCount: 2 },
      ],
    });
    // 唯一一間雙人房先被訂走
    await api.post("/activities/submit", {
      pendingCeremonyRegistrations: [{ ceremonyId: ceremony.id, walkInName: "先來的", roomType: "雙人房", amount: 3000 }],
    });

    await loginWithTemple(page, "volunteer");
    await openCeremonyRegistration(page, name);
    await page.getByLabel("房型", { exact: true }).click();
    await expect(
      page.locator(".ant-select-dropdown:visible .ant-select-item-option-disabled", { hasText: "雙人房" }),
    ).toContainText("剩 0 間");
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "四人房" }).click();

    // 四人房：可以一直加到 4 位，加滿後「新增參加者」就消失
    const participant = (n: number) => page.locator(".ant-card-small", { hasText: `參加者 ${n}` });
    const names = ["甲", "乙", "丙", "丁"];
    for (let i = 0; i < names.length; i++) {
      if (i > 0) await page.getByRole("button", { name: /新增參加者/ }).click();
      await radioButton(participant(i + 1), "臨櫃香客").click();
      await participant(i + 1).getByPlaceholder("姓名").fill(names[i]);
    }
    await expect(page.getByText("四人房每間最多 4 人，目前 4 人")).toBeVisible();
    await expect(page.getByRole("button", { name: /新增參加者/ })).toHaveCount(0);
    await expect(page.getByRole("spinbutton", { name: "金額" })).toHaveValue("5200");

    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（四人房　甲、乙、丙、丁）`)).toBeVisible();
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("NT$ 5,200");
    await expect(receipt.locator("body")).toContainText("四人房｜甲、乙、丙、丁");

    // 後端：四人房已訂 1 間，4 個人都在第 1 間
    const report = await api.get(`/ceremony/ceremonies/${ceremony.id}/report`);
    const fourBed = report.registrations.filter((r: { roomType: string }) => r.roomType === "四人房");
    expect(fourBed.map((r: { participantName: string; roomNumber: number }) => [r.participantName, r.roomNumber])).toEqual([
      ["甲", 1],
      ["乙", 1],
      ["丙", 1],
      ["丁", 1],
    ]);
  });

  test("唯讀帳號可以瀏覽頁面，但送出報名會被擋下", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `唯讀測試-${Date.now()}`;
    await api.post("/ceremony/ceremonies", { templeId: await api.templeId(), name, date: futureDate(), feeMode: "FREE_WILL" });

    await loginWithTemple(page, "viewer");
    await openCeremonyRegistration(page, name);
    await radioButton(page, "臨櫃香客（免建檔）").click();
    await page.getByLabel("姓名", { exact: true }).fill("參觀的人");
    await page.getByRole("spinbutton", { name: "金額" }).fill("100");
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await page.getByRole("button", { name: "送出並開立收據" }).click();
    await expect(page.getByText("此帳號為唯讀帳號，無法執行此操作")).toBeVisible();
  });
});
