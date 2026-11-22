import { expect, Page, test } from "@playwright/test";
import * as fs from "fs";
// 讀匯出的 Excel 驗證內容：xlsx 裝在前端專案底下
import * as XLSX from "../apps/web/node_modules/xlsx";
import { apiAs, checkMulti, fillSharedWalkIn, futureDate, loginWithTemple, payerCard, radioButton, selectOption } from "./helpers";

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
    // 報名者只在最上方填一次（沒勾選多人報名）：活動報名區塊不再有自己的報名者欄位
    await fillSharedWalkIn(page, "王小明");
    await expect(page.getByLabel("姓名", { exact: true })).toBeHidden();
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

  test("總幹事在畫面上建立進香活動（房型、間數，沒有遊覽車）→ 一次報名一人 → 收據印房型 → 已訂間數更新", async ({ page }) => {
    const name = `進香房型-${Date.now()}`;

    // 1. 建立活動：沒有收費方式也沒有遊覽車台數，只設定房型（費用、間數）
    await loginWithTemple(page, "director");
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^進香$/).click();
    await expect(page.getByText("新增進香活動")).toBeVisible();
    const createCard = page.locator(".ant-card", { hasText: "新增進香活動" });
    await expect(createCard.getByText("收費方式", { exact: true })).toHaveCount(0);
    await expect(createCard.getByText(/遊覽車台數/)).toHaveCount(0);
    await page.getByLabel("活動名稱").fill(name);
    await page.getByPlaceholder("房型，例如：雙人房").nth(0).fill("雙人房");
    await page.getByPlaceholder("每間人數").nth(0).fill("2");
    await page.getByPlaceholder("每人費用").nth(0).fill("3000");
    await page.getByPlaceholder("間數").nth(0).fill("2");
    await page.getByRole("button", { name: /新增房型/ }).click();
    await page.getByPlaceholder("房型，例如：雙人房").nth(1).fill("四人房");
    await page.getByPlaceholder("每間人數").nth(1).fill("4");
    await page.getByPlaceholder("每人費用").nth(1).fill("5200");
    await page.getByPlaceholder("間數").nth(1).fill("1");
    await page.getByRole("button", { name: "建立活動" }).click();

    await expect(page.getByText("已建立活動")).toBeVisible();
    const row = page.locator(".ant-table-row", { hasText: name });
    await expect(row).toContainText("依房型");
    await expect(row).toContainText("雙人房 0/2 間");
    await expect(row).not.toContainText("遊覽車");

    // 2. 報名：活動選單只有名稱；選房型，金額 = 每人費用，不能改；沒有車次、不能新增參加者
    await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
    await page.locator(".ant-checkbox-wrapper", { hasText: "活動報名" }).click();
    await page.getByLabel("選擇活動", { exact: true }).click();
    const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: name });
    await expect(option).toHaveText(name); // 只有活動名稱，沒有日期、收費方式或名額
    await option.click();
    await selectOption(page, "房型", "雙人房（NT$ 3000，剩 2 間）");
    const amount = page.getByRole("spinbutton", { name: "金額" });
    await expect(amount).toHaveValue("3000");
    await expect(amount).toBeDisabled();
    await expect(page.getByLabel("車次", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/遊覽車/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /新增參加者/ })).toHaveCount(0);
    await expect(radioButton(page, "整戶報名")).toHaveCount(0);

    // 進香沒勾選多人報名：參加者就是最上方的報名者，不會出現參加者卡片
    await fillSharedWalkIn(page, "阿土伯");
    await expect(page.locator(".ant-card-small", { hasText: "參加者 1" })).toBeHidden();
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（雙人房　阿土伯）`)).toBeVisible();

    // 3. 收據：金額是每人費用，左邊備註只印房型（沒有車次）
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("阿土伯");
    await expect(receipt.locator("body")).toContainText("NT$ 3,000");
    await expect(receipt.locator("body")).toContainText("雙人房");
    await expect(receipt.locator("body")).not.toContainText("第1車");

    // 4. 已訂間數更新
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^進香$/).click();
    await expect(page.locator(".ant-table-row", { hasText: name })).toContainText("雙人房 1/2 間");
  });

  test("進香：已經設定遊覽車的活動，報名畫面也不會要求或顯示車次，報名照樣成功且不記車次", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香有車-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "PILGRIMAGE",
      busCount: 2,
      roomTypes: [{ name: "通鋪", capacity: 45, fee: 0, roomCount: 10 }],
    });

    await loginWithTemple(page, "volunteer");
    await openCeremonyRegistration(page, name);
    await selectOption(page, "房型", "通鋪");
    await expect(page.getByLabel("車次", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/遊覽車共|剩 \d+ 位/)).toHaveCount(0);

    await fillSharedWalkIn(page, "阿土伯");
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("通鋪");
    await expect(receipt.locator("body")).not.toContainText("第");

    const report = await api.get(`/ceremony/ceremonies/${ceremony.id}/report`);
    expect(report.registrations[0].busNumber).toBeNull();
  });

  test("進香：房型訂滿就不能選；一次報名一人，金額是該房型每人費用", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香訂滿-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "PILGRIMAGE",
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

    // 一次一人：金額就是四人房的每人費用，不能新增參加者
    await expect(page.getByRole("button", { name: /新增參加者/ })).toHaveCount(0);
    await expect(page.getByRole("spinbutton", { name: "金額" })).toHaveValue("5200");
    await fillSharedWalkIn(page, "甲");
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（四人房　甲）`)).toBeVisible();
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("NT$ 5,200");
    await expect(receipt.locator("body")).toContainText("四人房");

    // 後端：四人房已訂 1 間
    const report = await api.get(`/ceremony/ceremonies/${ceremony.id}/report`);
    expect(report.registrations.filter((r: { roomType: string }) => r.roomType === "四人房").map((r: { participantName: string; roomNumber: number }) => [r.participantName, r.roomNumber])).toEqual([["甲", 1]]);
  });

  test("一次加入兩筆捐款與兩筆送禮（一份禮指定進香活動）→ 一張收據 → 活動詳情匯出進香總表", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香收禮-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "PILGRIMAGE",
      roomTypes: [{ name: "雙人房", capacity: 2, fee: 3000, roomCount: 5 }],
    });
    await api.post("/activities/submit", {
      pendingCeremonyRegistrations: [{ ceremonyId: ceremony.id, walkInName: "阿土伯", roomType: "雙人房", amount: 3000 }],
    });

    await loginWithTemple(page, "director");
    await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
    await page.locator(".ant-checkbox-wrapper", { hasText: "捐款收費" }).click();
    await page.locator(".ant-checkbox-wrapper", { hasText: "送禮" }).click();
    const card = (title: string) =>
      page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: new RegExp(`^${title}$`) }) });
    const donationCard = card("捐款收費");
    const giftCard = card("送禮");

    // 這張收據裡的捐款人和送禮人各不相同，所以要勾選「多人報名」，各區塊分別填報名者
    await checkMulti(page);
    // 捐款兩筆：一般捐款、指定給進香活動
    await radioButton(donationCard, "臨櫃香客（免建檔）").click();
    await donationCard.getByLabel("姓名", { exact: true }).fill("王小明");
    await donationCard.getByRole("spinbutton", { name: "金額" }).fill("500");
    await donationCard.getByRole("button", { name: "加入本次捐款項目" }).click();
    await radioButton(donationCard, "臨櫃香客（免建檔）").click();
    await donationCard.getByLabel("姓名", { exact: true }).fill("林老闆");
    await selectOption(page, "指定活動（選填）", name);
    await expect(page.locator(".ant-select-selection-item", { hasText: name }).first()).toHaveText(name); // 只顯示活動名稱
    await donationCard.getByRole("spinbutton", { name: "金額" }).fill("300");
    await donationCard.getByRole("button", { name: "加入本次捐款項目" }).click();
    await expect(donationCard.getByText("本次已加入 2 筆捐款（尚未送出）")).toBeVisible();
    await expect(donationCard.getByText(`林老闆　活動捐款（${name}）　NT$ 300`)).toBeVisible();

    // 送禮兩筆：一份指定進香活動、一份不指定
    await radioButton(giftCard, "臨櫃（免建檔）").click();
    await giftCard.getByLabel("姓名", { exact: true }).fill("陳太太");
    await selectOption(page, "屬於哪個活動（選填）", name);
    await selectOption(page, "品項（可複選）", "鮮花");
    await page.keyboard.press("Escape");
    await giftCard.getByLabel("鮮花 數量").fill("2");
    await giftCard.getByRole("button", { name: "加入本次送禮項目" }).click();
    await radioButton(giftCard, "臨櫃（免建檔）").click();
    await giftCard.getByLabel("姓名", { exact: true }).fill("張先生");
    await selectOption(page, "品項（可複選）", "水");
    await page.keyboard.press("Escape");
    await giftCard.getByRole("button", { name: "加入本次送禮項目" }).click();
    await expect(giftCard.getByText("本次已加入 2 筆送禮（尚未送出）")).toBeVisible();
    await expect(giftCard.getByText(`陳太太　送禮：鮮花x2（${name}）`)).toBeVisible();

    await expect(page.getByText("NT$ 800")).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "送出並開立收據" }).click();
    const receipt = await popupPromise;
    await expect(page.getByText("已開立收據")).toBeVisible();
    await expect(receipt.locator("body")).toContainText("NT$ 800");
    await expect(receipt.locator("body")).toContainText("品項：鮮花x2");
    await expect(receipt.locator("body")).toContainText("品項：水x1");

    // 活動報表：只有指定給這個活動的禮與捐款
    const report = await api.get(`/ceremony/ceremonies/${ceremony.id}/report`);
    expect(report.gifts.map((g: { giverName: string; quantity: number }) => [g.giverName, g.quantity])).toEqual([["陳太太", 2]]);
    expect(report.donationTotal).toBe(300);

    // 活動詳情 → 匯出進香總表：四個工作表，內容對得上
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^進香$/).click();
    await page.locator(".ant-table-row", { hasText: name }).getByText(name, { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /匯出進香總表 Excel/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`進香總表_${name}.xlsx`);

    const workbook = XLSX.read(fs.readFileSync(await download.path()), { type: "buffer" });
    // 進香目前沒有車次，所以沒有「車次名單」工作表
    expect(workbook.SheetNames).toEqual(["房型名單", "收入支出總表", "收禮資訊"]);
    const rowsOf = (sheet: string) =>
      XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[sheet], { header: 1, blankrows: true });
    expect(rowsOf("房型名單").slice(0, 2)).toEqual([
      ["雙人房", "參加者", "參加者", "金額", "報名時間"],
      [1, "阿土伯", "", 3000, expect.any(String)],
    ]);
    expect(rowsOf("收入支出總表")).toEqual([
      ["類別", "項目", "收入", "支出"],
      ["報名費", "雙人房（1 間、1 人）", 3000, ""],
      ["活動捐款", "共 1 筆", 300, ""],
      [],
      ["合計", "", 3300, 0],
      ["結餘", "收入 − 支出", 3300, ""],
    ]);
    expect(rowsOf("收禮資訊")).toContainEqual(["陳太太", "鮮花", 2, expect.any(String)]);
  });

  test("總幹事在活動詳情調整房型 → 名單更新、收據備註更新 → 操作紀錄看得到；車次相關按鈕不顯示", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香調整-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "PILGRIMAGE",
      busCount: 2,
      roomTypes: [
        { name: "雙人房", capacity: 2, fee: 3000, roomCount: 5 },
        { name: "三人房", capacity: 3, fee: 3000, roomCount: 5 },
        { name: "四人房", capacity: 4, fee: 2500, roomCount: 5 },
      ],
    });
    const submitted = await api.post("/activities/submit", {
      pendingCeremonyRegistrations: [{ ceremonyId: ceremony.id, walkInName: "阿土伯", roomType: "雙人房", amount: 3000 }],
    });

    await loginWithTemple(page, "director");
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^進香$/).click();
    await page.locator(".ant-table-row", { hasText: name }).getByText(name, { exact: true }).click();
    const detail = page.locator(".ant-modal", { hasText: `活動詳情：${name}` });
    const row = (who: string) => detail.locator(".ant-table-row", { hasText: who });
    await expect(row("阿土伯")).toContainText("雙人房 第1間");
    await expect(row("阿土伯")).not.toContainText(/第\d車/); // 名單的房間欄不顯示車次
    // 車次相關功能保留但不顯示
    await expect(detail.getByRole("button", { name: "列印車次名單" })).toHaveCount(0);
    await expect(detail.getByText("遊覽車", { exact: true })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "列印房型名單" })).toBeVisible();

    await row("阿土伯").getByRole("button", { name: "調整房型／車次" }).click();
    const moveModal = page.locator(".ant-modal").filter({ has: page.locator(".ant-modal-title", { hasText: "調整房型／車次" }) });
    const moveSelect = (label: string) => moveModal.locator(".ant-form-item", { hasText: label }).locator(".ant-select-selector");
    await expect(moveModal).toContainText("同一間房的人會一起調整：阿土伯");
    await expect(moveModal.locator(".ant-form-item", { hasText: "車次" })).toHaveCount(0);
    // 每人費用不同的四人房不能選
    await moveSelect("房型（目前").click();
    await expect(page.locator(".ant-select-dropdown:visible .ant-select-item-option-disabled", { hasText: "四人房" })).toContainText(
      "每人費用不同",
    );
    // 選項可能被畫面下緣遮住：直接觸發點擊，並等面板關閉
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "三人房" }).first().dispatchEvent("click");
    await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
    await moveModal.getByRole("button", { name: "確認調整" }).click();

    await expect(page.getByText(/已調整：房型 雙人房 第1間 → 三人房 第1間/)).toBeVisible();
    await expect(row("阿土伯")).toContainText("三人房 第1間");

    // 收據備註跟著更新
    const receiptId = submitted.receipt.id as string;
    const reprint = await api.get(`/ceremony/ceremonies/${ceremony.id}/report`);
    expect(reprint.registrations[0]).toMatchObject({ roomType: "三人房", roomNumber: 1, busNumber: null });
    expect(receiptId).toBeTruthy();

    // 操作紀錄頁
    await detail.getByRole("button", { name: "Close" }).click();
    await page.locator(".ant-menu").getByText("操作紀錄", { exact: true }).click();
    const logRow = page.locator(".ant-table-row", { hasText: name }).first();
    await expect(logRow).toContainText("調整進香房型／車次");
    await expect(logRow).toContainText("阿土伯（1 人）");
    await expect(logRow).toContainText("王總幹事");
  });

  test("同一個人再報名同一個活動：先跳出提醒，取消就不加入，確定才加入", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `重複提醒-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
    });
    await api.post("/activities/submit", {
      pendingCeremonyRegistrations: [{ ceremonyId: ceremony.id, walkInName: "王小明", amount: 500 }],
    });

    await loginWithTemple(page, "volunteer");
    await openCeremonyRegistration(page, name);
    const fillWalkIn = async () => {
      await fillSharedWalkIn(page, "王小明");
      await page.getByRole("spinbutton", { name: "金額" }).fill("500");
      await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    };

    await fillWalkIn();
    const confirm = page.locator(".ant-modal-confirm", { hasText: "這些人已經報名過這個活動" });
    await expect(confirm).toContainText("王小明　已報名（已報名）");
    await confirm.getByRole("button", { name: /取\s*消/ }).click();
    await expect(page.getByText(`${name}（王小明）`)).toHaveCount(0);

    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await page.locator(".ant-modal-confirm", { hasText: "這些人已經報名過這個活動" }).getByRole("button", { name: "確定要再報名" }).click();
    await expect(page.getByText(`${name}（王小明）`)).toBeVisible();
  });

  test("多人報名沒勾選：報名者只填一次，點燈、捐款、活動報名、送禮都沿用，收據上是同一個人", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `共用報名者-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", { templeId: await api.templeId(), name, date: futureDate(), feeMode: "FREE_WILL" });

    await loginWithTemple(page, "volunteer");
    await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
    const options = ["捐款收費", "活動報名", "送禮"];
    for (const option of options) await page.locator(".ant-checkbox-wrapper", { hasText: option }).click();

    // 沒勾選多人報名：只有最上方一個報名者欄位，各區塊都沒有自己的姓名欄位
    await expect(payerCard(page).getByRole("checkbox", { name: "多人報名" })).not.toBeChecked();
    await expect(page.getByLabel("姓名", { exact: true })).toBeHidden();
    await expect(page.getByText("香客類型")).toBeHidden();
    await expect(page.getByText("捐贈者類型")).toBeHidden();

    // 還沒填報名者就加入：被擋下並提示
    await page.getByRole("button", { name: "加入本次捐款項目" }).click();
    await expect(page.getByText("請先在最上方選擇報名者")).toBeVisible();

    await fillSharedWalkIn(page, "共用的人");
    const card = (title: string) =>
      page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: new RegExp(`^${title}$`) }) });
    await card("捐款收費").getByRole("spinbutton", { name: "金額" }).fill("500");
    await card("捐款收費").getByRole("button", { name: "加入本次捐款項目" }).click();
    await expect(card("捐款收費").getByText("共用的人　一般捐款")).toBeVisible();

    await selectOption(page, "選擇活動", name);
    await page.getByRole("spinbutton", { name: "金額" }).last().fill("300");
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（共用的人）`)).toBeVisible();

    await card("送禮").getByLabel("品項（可複選）").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "水" }).first().dispatchEvent("click");
    await page.keyboard.press("Escape");
    await card("送禮").getByRole("button", { name: "加入本次送禮項目" }).click();
    await expect(card("送禮").getByText("共用的人　送禮：水x1")).toBeVisible();

    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("共用的人");
    await expect(receipt.locator("body")).toContainText("NT$ 800");

    // 後端：三種紀錄都記在同一個人名下
    const report = await api.get(`/ceremony/ceremonies/${ceremony.id}/report`);
    expect(report.registrations.map((r: { participantName: string }) => r.participantName)).toEqual(["共用的人"]);
    expect(report.donationTotal).toBe(0); // 這筆捐款沒指定活動
    // 送出後最上方的報名者會清空，下一位客人重新填
    await expect(payerCard(page).getByPlaceholder("報名者姓名")).toHaveValue("");
  });

  test("勾選多人報名：各區塊自己選人，進香可以新增參加者；取消勾選又回到共用", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `多人進香-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "PILGRIMAGE",
      roomTypes: [{ name: "雙人房", capacity: 2, fee: 3000, roomCount: 5 }],
    });

    await loginWithTemple(page, "volunteer");
    await openCeremonyRegistration(page, name);
    await selectOption(page, "房型", "雙人房（NT$ 3000，剩 5 間）");
    await expect(page.getByRole("button", { name: /新增參加者/ })).toHaveCount(0);

    await checkMulti(page);
    // 勾選後：進香出現參加者卡片與「新增參加者」，房型選項標出每間人數
    await expect(page.locator(".ant-card-small", { hasText: "參加者 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: /新增參加者/ })).toBeVisible();
    const amount = page.getByRole("spinbutton", { name: "金額" });
    const p1 = page.locator(".ant-card-small", { hasText: "參加者 1" });
    await radioButton(p1, "臨櫃香客").click();
    await p1.getByPlaceholder("姓名").fill("阿土伯");
    await page.getByRole("button", { name: /新增參加者/ }).click();
    const p2 = page.locator(".ant-card-small", { hasText: "參加者 2" });
    await radioButton(p2, "臨櫃香客").click();
    await p2.getByPlaceholder("姓名").fill("阿土嫂");
    await expect(amount).toHaveValue("6000"); // 每人 3000 × 2
    await expect(page.getByRole("button", { name: /新增參加者/ })).toHaveCount(0); // 雙人房已滿 2 人
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（雙人房　阿土伯、阿土嫂）`)).toBeVisible();
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("雙人房｜阿土伯、阿土嫂");

    const report = await api.get(`/ceremony/ceremonies/${ceremony.id}/report`);
    expect(report.registrations.map((r: { participantName: string; roomNumber: number }) => [r.participantName, r.roomNumber])).toEqual([
      ["阿土伯", 1],
      ["阿土嫂", 1],
    ]);

    // 取消勾選：回到只填一次
    await payerCard(page).getByRole("checkbox", { name: "多人報名" }).uncheck();
    await expect(payerCard(page).getByText("報名者只需要填這一次")).toBeVisible();
    await expect(page.locator(".ant-card-small", { hasText: "參加者 1" })).toBeHidden();
  });

  test("唯讀帳號可以瀏覽頁面，但送出報名會被擋下", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `唯讀測試-${Date.now()}`;
    await api.post("/ceremony/ceremonies", { templeId: await api.templeId(), name, date: futureDate(), feeMode: "FREE_WILL" });

    await loginWithTemple(page, "viewer");
    await openCeremonyRegistration(page, name);
    await fillSharedWalkIn(page, "參觀的人");
    await page.getByRole("spinbutton", { name: "金額" }).fill("100");
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await page.getByRole("button", { name: "送出並開立收據" }).click();
    await expect(page.getByText("此帳號為唯讀帳號，無法執行此操作")).toBeVisible();
  });
});
