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

  test("進香：登錄兩位參加者 → 在遊覽車座位圖選兩個座位 → 收據列出每個座位對應的人 → 座位變成已有人", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香E2E-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FIXED_AMOUNT",
      fixedAmount: 800,
      kind: "PILGRIMAGE",
    });

    await loginWithTemple(page, "volunteer");
    await openCeremonyRegistration(page, name);

    // 進香沒有「臨櫃香客」「認領整桌」這兩種報名者類型，改成登錄參加者名單
    await expect(radioButton(page, "登錄參加者（可多人）")).toBeVisible();
    await expect(radioButton(page, "臨櫃香客（免建檔）")).toHaveCount(0);
    await expect(radioButton(page, "認領整桌")).toHaveCount(0);

    // 登錄兩位參加者（都是臨櫃香客）
    const participant = (n: number) => page.locator(".ant-card-small", { hasText: `參加者 ${n}` });
    await radioButton(participant(1), "臨櫃香客").click();
    await participant(1).getByPlaceholder("姓名").fill("阿土伯");
    await page.getByRole("button", { name: /新增參加者/ }).click();
    await radioButton(participant(2), "臨櫃香客").click();
    await participant(2).getByPlaceholder("姓名").fill("阿土嫂");

    // 固定金額 800 × 2 人，自動算成 1600
    await expect(page.getByRole("spinbutton", { name: "金額" })).toHaveValue("1600");
    await expect(page.getByText("此活動為固定金額，已自動算成單價 x 2 人")).toBeVisible();

    // 座位還沒選，不能加入
    await expect(page.getByRole("button", { name: "加入本次活動報名項目" })).toBeDisabled();

    // 開座位圖：要選滿 2 位才能確認；門的位置沒有座位
    await page.getByRole("button", { name: "選擇遊覽車座位（需選 2 位）" }).click();
    const modal = page.locator(".ant-modal", { hasText: "遊覽車選位" });
    await expect(modal.getByTitle(/排\d號/)).toHaveCount(40);
    await expect(modal.getByTitle(/^1排3號/)).toHaveCount(0);
    const confirm = modal.getByRole("button", { name: /確認選位/ });
    await expect(confirm).toBeDisabled();
    await modal.getByTitle("3排1號（空位）").click();
    await expect(confirm).toBeDisabled();
    await modal.getByTitle("3排2號（空位）").click();
    await expect(modal.getByTitle("3排1號（已選）")).toBeVisible();
    // 已經選滿 2 位，再點第 3 個不會被選上
    await modal.getByTitle("4排1號（空位）").click();
    await expect(modal.getByTitle("4排1號（空位）")).toBeVisible();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(participant(1)).toContainText("座位 3排1號");
    await expect(participant(2)).toContainText("座位 3排2號");

    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await page.locator(".ant-modal-confirm").getByRole("button").click();
    await expect(page.getByText(`${name}（阿土伯 3排1號、阿土嫂 3排2號）`)).toBeVisible();

    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("阿土伯");
    await expect(receipt.locator("body")).toContainText("NT$ 1,600");
    await expect(receipt.locator("body")).toContainText("座位｜3排1號 阿土伯、3排2號 阿土嫂");

    // 後端：兩個座位已被佔用，姓名各自正確
    const seats = await api.get(`/ceremony/ceremonies/${ceremony.id}/seats`);
    const taken = seats.filter((s: { status: string }) => s.status === "TAKEN");
    expect(taken.map((s: { seatIndex: number; participantName: string }) => [s.seatIndex, s.participantName])).toEqual([
      [9, "阿土伯"],
      [10, "阿土嫂"],
    ]);

    // 畫面：下一位報名者打開座位圖時，這兩個座位顯示成已有人、不能再選
    await openCeremonyRegistration(page, name);
    await page.getByRole("button", { name: "選擇遊覽車座位（需選 1 位）" }).click();
    const modalAgain = page.locator(".ant-modal", { hasText: "遊覽車選位" });
    await expect(modalAgain.getByTitle("3排1號：阿土伯")).toBeVisible();
    await expect(modalAgain.getByTitle("3排2號：阿土嫂")).toBeVisible();
    await modalAgain.getByTitle("3排1號：阿土伯").click();
    await expect(modalAgain.getByRole("button", { name: /確認選位/ })).toBeDisabled();
  });

  test("總幹事在畫面上建立有房型的進香活動 → 選雙人房自動帶 2 位參加者與房型費用 → 收據備註帶房型", async ({ page }) => {
    const name = `進香房型-${Date.now()}`;

    // 1. 在「建立活動」頁建立進香活動：畫面上沒有收費方式欄位，改設定房型與費用
    await loginWithTemple(page, "director");
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^進香$/).click();
    await expect(page.getByText("新增進香活動")).toBeVisible();
    const createCard = page.locator(".ant-card", { hasText: "新增進香活動" });
    await expect(createCard.getByText("收費方式", { exact: true })).toHaveCount(0);
    await page.getByLabel("活動名稱").fill(name);
    await page.getByPlaceholder("房型，例如：雙人房").nth(0).fill("雙人房");
    await page.getByPlaceholder("人數").nth(0).fill("2");
    await page.getByPlaceholder("費用").nth(0).fill("3000");
    await page.getByRole("button", { name: /新增房型/ }).click();
    await page.getByPlaceholder("房型，例如：雙人房").nth(1).fill("四人房");
    await page.getByPlaceholder("人數").nth(1).fill("4");
    await page.getByPlaceholder("費用").nth(1).fill("5200");
    await page.getByRole("button", { name: "建立活動" }).click();

    await expect(page.getByText("已建立活動")).toBeVisible();
    const row = page.locator(".ant-table-row", { hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("依房型");

    // 2. 報名：選雙人房後參加者自動變成 2 位、不能增減，金額帶入房型費用且不能改
    await openCeremonyRegistration(page, name);
    await selectOption(page, "房型", "雙人房（2 人，NT$ 3000）");
    const participant = (n: number) => page.locator(".ant-card-small", { hasText: `參加者 ${n}` });
    await expect(participant(2)).toBeVisible();
    await expect(participant(3)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /新增參加者/ })).toHaveCount(0);
    const amount = page.getByRole("spinbutton", { name: "金額" });
    await expect(amount).toHaveValue("3000");
    await expect(amount).toBeDisabled();

    await radioButton(participant(1), "臨櫃香客").click();
    await participant(1).getByPlaceholder("姓名").fill("阿土伯");
    await radioButton(participant(2), "臨櫃香客").click();
    await participant(2).getByPlaceholder("姓名").fill("阿土嫂");

    await page.getByRole("button", { name: "選擇遊覽車座位（需選 2 位）" }).click();
    const modal = page.locator(".ant-modal", { hasText: "遊覽車選位" });
    await modal.getByTitle("5排1號（空位）").click();
    await modal.getByTitle("5排2號（空位）").click();
    await modal.getByRole("button", { name: /確認選位/ }).click();

    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await page.locator(".ant-modal-confirm").getByRole("button").click();
    await expect(page.getByText(`${name}（雙人房　阿土伯 5排1號、阿土嫂 5排2號）`)).toBeVisible();

    // 3. 收據：金額是房型費用，左邊備註前面帶房型
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("NT$ 3,000");
    await expect(receipt.locator("body")).toContainText("雙人房，座位｜5排1號 阿土伯、5排2號 阿土嫂");
  });

  test("進香：選好座位後又增加參加者，已選的座位會清空要求重選", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香重選-${Date.now()}`;
    await api.post("/ceremony/ceremonies", { templeId: await api.templeId(), name, date: futureDate(), feeMode: "FREE_WILL", kind: "PILGRIMAGE" });

    await loginWithTemple(page, "volunteer");
    await openCeremonyRegistration(page, name);
    const participant = (n: number) => page.locator(".ant-card-small", { hasText: `參加者 ${n}` });
    await radioButton(participant(1), "臨櫃香客").click();
    await participant(1).getByPlaceholder("姓名").fill("甲");

    await page.getByRole("button", { name: "選擇遊覽車座位（需選 1 位）" }).click();
    const modal = page.locator(".ant-modal", { hasText: "遊覽車選位" });
    await modal.getByTitle("5排1號（空位）").click();
    await modal.getByRole("button", { name: /確認選位/ }).click();
    await expect(participant(1)).toContainText("座位 5排1號");

    await page.getByRole("button", { name: /新增參加者/ }).click();
    await expect(page.getByRole("button", { name: "選擇遊覽車座位（需選 2 位）" })).toBeVisible();
    await expect(participant(1)).not.toContainText("座位 5排1號");
    await expect(page.getByRole("button", { name: "加入本次活動報名項目" })).toBeDisabled();
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
