import { expect, Page, test } from "@playwright/test";
import * as fs from "fs";
// 讀匯出的 Excel 驗證內容：xlsx 裝在前端專案底下
import * as XLSX from "../apps/web/node_modules/xlsx";
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
    await expect(row).toContainText("遊覽車 0/40 人");
    await expect(row).toContainText("雙人房 0/2 間");

    // 2. 報名：選雙人房，金額 = 每人費用 × 人數且不能改；只登錄 1 位也可以；沒有遊覽車選位
    await openCeremonyRegistration(page, name);
    await selectOption(page, "房型", "雙人房（每間最多 2 人，每人 NT$ 3000，剩 2 間）");
    const amount = page.getByRole("spinbutton", { name: "金額" });
    await expect(amount).toHaveValue("3000");
    await expect(amount).toBeDisabled();
    await expect(page.getByText("遊覽車共 1 台（每台 40 位）：第 1 車剩 40 位")).toBeVisible();
    // 只有 1 台車不用選車次
    await expect(page.getByLabel("車次", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /選擇遊覽車座位/ })).toHaveCount(0);
    await expect(radioButton(page, "整戶報名")).toHaveCount(0);

    const participant = (n: number) => page.locator(".ant-card-small", { hasText: `參加者 ${n}` });
    await radioButton(participant(1), "臨櫃香客").click();
    await participant(1).getByPlaceholder("姓名").fill("阿土伯");
    await expect(page.getByText("雙人房每間最多 2 人，目前 1 人")).toBeVisible();
    await expect(page.getByText("雙人房每人 NT$ 3000 × 1 人")).toBeVisible();

    // 加第 2 位金額變 6000，移除後回到 3000
    await page.getByRole("button", { name: /新增參加者/ }).click();
    await expect(amount).toHaveValue("6000");
    await participant(2).getByRole("button", { name: /移\s?除/ }).click();
    await expect(amount).toHaveValue("3000");

    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（第1車　雙人房　阿土伯）`)).toBeVisible();

    // 3. 收據：金額是房費，左邊備註印房型
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("阿土伯");
    await expect(receipt.locator("body")).toContainText("NT$ 3,000");
    await expect(receipt.locator("body")).toContainText("第1車，雙人房");

    // 4. 已訂間數與遊覽車人數都更新
    await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
    await radioButton(page, /^進香$/).click();
    const rowAfter = page.locator(".ant-table-row", { hasText: name });
    await expect(rowAfter).toContainText("遊覽車 1/40 人");
    await expect(rowAfter).toContainText("雙人房 1/2 間");
  });

  test("進香：兩台遊覽車要選車次，車次坐滿就不能選，收據印車次", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香車次-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "PILGRIMAGE",
      busCount: 2,
      roomTypes: [{ name: "通鋪", capacity: 45, fee: 0, roomCount: 10 }],
    });
    // 第 1 車先坐滿 40 人
    await api.post("/activities/submit", {
      pendingCeremonyRegistrations: [
        {
          ceremonyId: ceremony.id,
          walkInName: "領隊",
          roomType: "通鋪",
          busNumber: 1,
          amount: 0,
          passengerMemberIds: Array(40).fill(""),
          passengerNames: ["", ...Array.from({ length: 39 }, (_, i) => `乘客${i + 1}`)],
        },
      ],
    });

    await loginWithTemple(page, "volunteer");
    await openCeremonyRegistration(page, name);
    await selectOption(page, "房型", "通鋪");

    // 車次選單：第 1 車已滿不能選；沒選車次不能加入
    await page.getByLabel("車次", { exact: true }).click();
    await expect(
      page.locator(".ant-select-dropdown:visible .ant-select-item-option-disabled", { hasText: "第 1 車" }),
    ).toContainText("剩 0 位");
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "第 2 車" }).click();
    await expect(page.getByText(/第 1 車剩 0 位、第 2 車剩 40 位/)).toBeVisible();

    const participant = (n: number) => page.locator(".ant-card-small", { hasText: `參加者 ${n}` });
    await radioButton(participant(1), "臨櫃香客").click();
    await participant(1).getByPlaceholder("姓名").fill("阿土伯");
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（第2車　通鋪　阿土伯）`)).toBeVisible();

    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("第2車，通鋪");

    const report = await api.get(`/ceremony/ceremonies/${ceremony.id}/report`);
    expect(report.ceremony.busLoads).toEqual([40, 1]);
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
    await expect(page.getByRole("spinbutton", { name: "金額" })).toHaveValue("20800"); // 每人 5200 × 4 人

    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await expect(page.getByText(`${name}（第1車　四人房　甲、乙、丙、丁）`)).toBeVisible();
    const receipt = await submitAndGetReceipt(page);
    await expect(receipt.locator("body")).toContainText("NT$ 20,800");
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

  test("一次加入兩筆捐款與兩筆送禮（一份禮指定進香活動）→ 一張收據 → 活動詳情匯出進香總表", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const name = `進香收禮-${Date.now()}`;
    const ceremony = await api.post("/ceremony/ceremonies", {
      templeId: await api.templeId(),
      name,
      date: futureDate(),
      feeMode: "FREE_WILL",
      kind: "PILGRIMAGE",
      busCount: 1,
      roomTypes: [{ name: "雙人房", capacity: 2, fee: 3000, roomCount: 5 }],
    });
    await api.post("/activities/submit", {
      pendingCeremonyRegistrations: [
        {
          ceremonyId: ceremony.id,
          walkInName: "阿土伯",
          roomType: "雙人房",
          amount: 6000,
          passengerMemberIds: ["", ""],
          passengerNames: ["", "阿土嫂"],
        },
      ],
    });

    await loginWithTemple(page, "director");
    await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
    await page.locator(".ant-checkbox-wrapper", { hasText: "捐款收費" }).click();
    await page.locator(".ant-checkbox-wrapper", { hasText: "送禮" }).click();
    const card = (title: string) =>
      page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: new RegExp(`^${title}$`) }) });
    const donationCard = card("捐款收費");
    const giftCard = card("送禮");

    // 捐款兩筆：一般捐款、指定給進香活動
    await radioButton(donationCard, "臨櫃香客（免建檔）").click();
    await donationCard.getByLabel("姓名", { exact: true }).fill("王小明");
    await donationCard.getByRole("spinbutton", { name: "金額" }).fill("500");
    await donationCard.getByRole("button", { name: "加入本次捐款項目" }).click();
    await radioButton(donationCard, "臨櫃香客（免建檔）").click();
    await donationCard.getByLabel("姓名", { exact: true }).fill("林老闆");
    await selectOption(page, "指定活動（選填）", name);
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
    expect(workbook.SheetNames).toEqual(["房型名單", "車次名單", "收入支出總表", "收禮資訊"]);
    const rowsOf = (sheet: string) =>
      XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[sheet], { header: 1, blankrows: true });
    expect(rowsOf("房型名單").slice(0, 2)).toEqual([
      ["雙人房", "參加者", "參加者", "金額", "報名時間"],
      [1, "阿土伯", "阿土嫂", 6000, expect.any(String)],
    ]);
    expect(rowsOf("車次名單")[0]).toEqual(["第1車", "參加者", "房型", "第幾間", "報名時間"]);
    expect(rowsOf("收入支出總表")).toEqual([
      ["類別", "項目", "收入", "支出"],
      ["報名費", "雙人房（1 間、2 人）", 6000, ""],
      ["活動捐款", "共 1 筆", 300, ""],
      [],
      ["合計", "", 6300, 0],
      ["結餘", "收入 − 支出", 6300, ""],
    ]);
    expect(rowsOf("收禮資訊")).toContainEqual(["陳太太", "鮮花", 2, expect.any(String)]);
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
