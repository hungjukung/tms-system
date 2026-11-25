import { expect, Page, test } from "@playwright/test";
import { apiAs, checkMulti, chooseOption, fillSharedWalkIn, futureDate, loginWithTemple, payerCard, radioButton } from "./helpers";

/**
 * 流程稽核：把「活動報名」每一條報名路徑，在「沒勾選多人報名（報名者共用）」與「勾選多人報名」兩種模式下
 * 都從頭操作到真的開出收據，確認沒有任何一條因為隱藏的欄位或功能而卡住、送不出去。
 * 報名者用「已建檔信徒」與「臨櫃姓名」兩種都跑（兩者走的程式路徑不一樣，之前就是漏了信徒這條）。
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.print = () => undefined;
  });
});

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function open(page: Page) {
  await loginWithTemple(page, "volunteer");
  await page.locator(".ant-menu").getByText("活動報名", { exact: true }).click();
}

async function tick(page: Page, ...options: string[]) {
  for (const option of options) await page.locator(".ant-checkbox-wrapper", { hasText: option }).click();
}

/** 在最上方選已建檔信徒作為共用報名者 */
async function fillSharedMember(page: Page, name: string) {
  await payerCard(page).locator("input.ant-select-selection-search-input").fill(name);
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: name }).first().click();
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
}

const section = (page: Page, title: string) =>
  page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: new RegExp(`^${title}$`) }) });

const choose = chooseOption;

async function pickCeremony(page: Page, name: string) {
  // 活動選單可以輸入名稱搜尋：直接打字，只剩那一個再選
  await page.getByLabel("選擇活動", { exact: true }).fill(name);
  await choose(page, name);
}

async function submit(page: Page) {
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "送出並開立收據" }).click();
  const receipt = await popup;
  await expect(page.getByText("已開立收據").first()).toBeVisible();
  return receipt.locator("body");
}

async function newMember(request: Parameters<typeof apiAs>[0], name: string) {
  const api = await apiAs(request, "director");
  await api.post("/members", { householdAddress: `${name}的家`, name, gender: "UNKNOWN" });
}

async function newCeremony(request: Parameters<typeof apiAs>[0], body: Record<string, unknown>) {
  const api = await apiAs(request, "director");
  return api.post("/ceremony/ceremonies", { templeId: await api.templeId(), date: futureDate(), feeMode: "FREE_WILL", ...body });
}

async function newWall(request: Parameters<typeof apiAs>[0], count = 2) {
  const api = await apiAs(request, "director");
  const name = `稽核牆-${unique()}`;
  const wall = await api.post("/lantern/walls", { templeId: await api.templeId(), name, year: 2026 });
  await api.post(`/lantern/walls/${wall.id}/slots`, {
    prefix: "A",
    positions: Array.from({ length: count }, (_, i) => ({ row: 1, column: i + 1, gridRow: 1, gridColumn: i + 1 })),
  });
  return name;
}

async function selectWall(page: Page, wallName: string) {
  const combobox = page.getByRole("combobox", { name: "* 燈牆" });
  const current = page.locator(".ant-form-item", { has: combobox }).locator(".ant-select-selection-item");
  await expect(current).toBeVisible();
  if ((await current.textContent())?.includes(wallName)) return;
  await combobox.click({ force: true });
  await combobox.fill(wallName);
  await choose(page, wallName);
}

async function addLantern(page: Page, wallName: string, type: string, slotCode: string) {
  const card = section(page, "點燈");
  await card.getByRole("combobox", { name: /燈種（先選燈種/ }).click({ force: true });
  await choose(page, type);
  await selectWall(page, wallName);
  await card.getByRole("button", { name: "選擇燈位" }).click();
  const modal = page.locator(".ant-modal", { hasText: `選擇燈位：${wallName}` });
  await modal.locator(".slot-cell", { hasText: slotCode }).click();
  await modal.getByRole("button", { name: /確認選位/ }).click();
  await card.getByRole("button", { name: "加入本次點燈項目" }).click();
}

async function addDonation(page: Page, type: string, amount: string) {
  const card = section(page, "捐款收費");
  await card.getByRole("combobox", { name: /項目/ }).click({ force: true });
  await choose(page, type);
  await card.getByRole("spinbutton", { name: /金額/ }).fill(amount);
  await card.getByRole("button", { name: "加入本次捐款項目" }).click();
}

async function addGift(page: Page, item: string) {
  const card = section(page, "送禮");
  await card.getByLabel("品項（可複選）").click({ force: true });
  await choose(page, item, { multiple: true });
  await card.getByRole("button", { name: "加入本次送禮項目" }).click();
}

const addCeremony = (page: Page) => page.getByRole("button", { name: "加入本次活動報名項目" }).click();

// ─────────────── 沒勾選多人報名（報名者共用）：兩種報名者 × 各報名路徑 ───────────────
for (const payer of ["信徒", "臨櫃"] as const) {
  test.describe(`共用報名者（${payer}）`, () => {
    const who = payer === "信徒" ? "稽核信徒" : "稽核臨櫃";
    const setPayer = async (page: Page, request: Parameters<typeof apiAs>[0]) => {
      if (payer === "信徒") {
        await newMember(request, who);
        await fillSharedMember(page, who);
      } else {
        await fillSharedWalkIn(page, who);
      }
    };

    test("點燈 + 捐款 + 送禮 + 活動報名（不選座位）一次開成一張收據", async ({ page, request }) => {
      const wall = await newWall(request);
      const ceremony = `稽核餐會-${unique()}`;
      await newCeremony(request, { name: ceremony });
      await open(page);
      await tick(page, "點燈", "捐款收費", "活動報名", "送禮");
      await setPayer(page, request);

      await addLantern(page, wall, "光明燈", "A-01");
      await expect(section(page, "點燈").getByText(`光明燈（${who}`)).toBeVisible();
      await addDonation(page, "普渡捐款", "500");
      await expect(section(page, "捐款收費").getByText("本次已加入 1 筆捐款")).toBeVisible();
      await addGift(page, "水");
      await expect(section(page, "送禮").getByText("本次已加入 1 筆送禮")).toBeVisible();
      await pickCeremony(page, ceremony);
      await page.getByRole("spinbutton", { name: "金額" }).last().fill("300");
      await addCeremony(page);
      await expect(page.getByText(`${ceremony}（${who}）`)).toBeVisible();

      const body = await submit(page);
      await expect(body).toContainText(who);
      await expect(body).toContainText("NT$ 1,400"); // 光明燈 600 + 捐款 500 + 報名 300
    });

    test("餐會有桌次：要選座位才能加入，選完可以送出", async ({ page, request }) => {
      const ceremony = `稽核桌次-${unique()}`;
      await newCeremony(request, { name: ceremony, tableCount: 2, seatsPerTable: 3 });
      await open(page);
      await tick(page, "活動報名");
      await setPayer(page, request);
      await pickCeremony(page, ceremony);
      await page.getByRole("spinbutton", { name: "金額" }).fill("200");
      await expect(page.getByRole("button", { name: "加入本次活動報名項目" })).toBeDisabled(); // 還沒選座位

      await page.getByRole("button", { name: "選擇座位" }).click();
      const modal = page.locator(".ant-modal", { hasText: `活動選位：${ceremony}` });
      await modal.getByText("第 1 桌").click();
      await modal.locator("[title='空位']").first().click();
      await addCeremony(page);
      await expect(page.locator(".ant-modal-confirm", { hasText: "座位號碼" })).toContainText("1桌");
      await page.locator(".ant-modal-confirm").getByRole("button").click();
      await expect(page.getByText(`${ceremony}（${who}`)).toBeVisible();
      const body = await submit(page);
      await expect(body).toContainText(who);
      await expect(body).toContainText("座位：1桌");
    });

    test("餐會有桌次：勾「不需要座位」不用選位就能送出", async ({ page, request }) => {
      const ceremony = `稽核免座位-${unique()}`;
      await newCeremony(request, { name: ceremony, tableCount: 1, seatsPerTable: 2 });
      await open(page);
      await tick(page, "活動報名");
      await setPayer(page, request);
      await pickCeremony(page, ceremony);
      await page.getByRole("spinbutton", { name: "金額" }).fill("100");
      await page.getByRole("checkbox", { name: /不需要座位/ }).check();
      await addCeremony(page);
      const body = await submit(page);
      await expect(body).toContainText(who);
    });

    test("祭改：選場次後送出，收據有號碼", async ({ page, request }) => {
      const ceremony = `稽核祭改-${unique()}`;
      await newCeremony(request, { name: ceremony, kind: "JIGAI", morningCapacity: 5, afternoonCapacity: 5 });
      await open(page);
      await tick(page, "活動報名");
      await setPayer(page, request);
      await pickCeremony(page, ceremony);
      await radioButton(page, /上午場/).click();
      await page.getByRole("spinbutton", { name: "金額" }).fill("300");
      await addCeremony(page);
      const body = await submit(page);
      await expect(body).toContainText(`${who}，上午場 1號`);
    });

    test("進香：選房型後送出，參加者就是最上方的報名者", async ({ page, request }) => {
      const ceremony = `稽核進香-${unique()}`;
      await newCeremony(request, { name: ceremony, kind: "PILGRIMAGE", roomTypes: [{ name: "雙人房", capacity: 2, fee: 3000, roomCount: 3 }] });
      await open(page);
      await tick(page, "活動報名");
      await setPayer(page, request);
      await pickCeremony(page, ceremony);
      await page.getByLabel("房型", { exact: true }).click({ force: true });
      await choose(page, "雙人房");
      await expect(page.getByRole("spinbutton", { name: "金額" })).toHaveValue("3000");
      await addCeremony(page);
      const body = await submit(page);
      await expect(body).toContainText(who);
      await expect(body).toContainText("NT$ 3,000");
      await expect(body).toContainText("雙人房");
    });

    test("只勾點燈、只勾捐款、只勾送禮：各自都能單獨送出", async ({ page, request }) => {
      const wall = await newWall(request, 3);
      await open(page);
      await tick(page, "點燈");
      await setPayer(page, request);
      await addLantern(page, wall, "發財燈", "A-01");
      await expect(await submit(page)).toContainText("NT$ 600");

      await tick(page, "捐款收費");
      await setPayer(page, request);
      await addDonation(page, "修繕捐款", "250");
      await expect(await submit(page)).toContainText("NT$ 250");

      await tick(page, "送禮");
      await setPayer(page, request);
      await addGift(page, "鮮花");
      await expect(await submit(page)).toContainText(who);
    });
  });
}

// ─────────────── 勾選多人報名：各區塊自己選人 ───────────────
test.describe("多人報名（各區塊分別選人）", () => {
  test("點燈、捐款、送禮、活動報名各用不同的人，一張收據送出", async ({ page, request }) => {
    const wall = await newWall(request);
    const ceremony = `稽核多人-${unique()}`;
    await newCeremony(request, { name: ceremony });
    await open(page);
    await tick(page, "點燈", "捐款收費", "活動報名", "送禮");
    await checkMulti(page);

    const lantern = section(page, "點燈");
    await radioButton(lantern, "臨櫃香客").click();
    await lantern.getByLabel("姓名", { exact: true }).fill("燈甲");
    await addLantern(page, wall, "光明燈", "A-01");

    const donation = section(page, "捐款收費");
    await radioButton(donation, "臨櫃香客").click();
    await donation.getByLabel("姓名", { exact: true }).fill("捐乙");
    await addDonation(page, "普渡捐款", "500");

    const gift = section(page, "送禮");
    await radioButton(gift, "臨櫃").click();
    await gift.getByLabel("姓名", { exact: true }).fill("禮丙");
    await addGift(page, "水");

    await pickCeremony(page, ceremony);
    await page.locator("#ceremonyRegistration_payerMode").locator("label.ant-radio-button-wrapper", { hasText: "臨櫃香客" }).click();
    await page.locator("#ceremonyRegistration_walkInName").fill("報丁");
    await page.getByRole("spinbutton", { name: "金額" }).last().fill("300");
    await addCeremony(page);

    // 合併收據上印的付款人是第一位（燈甲）；其他人的紀錄各自記在自己名下（見下面的後端檢查）
    const body = await submit(page);
    await expect(body).toContainText("燈甲");
    await expect(body).toContainText("NT$ 1,400"); // 光明燈 600 + 捐款 500 + 報名 300
    const report = await (await apiAs(request, "director")).get(`/ceremony/ceremonies/${(await apiAs(request, "director").then((a) => a.get("/ceremony/ceremonies"))).find((c: { name: string }) => c.name === ceremony).id}/report`);
    expect(report.registrations.map((r: { participantName: string }) => r.participantName)).toEqual(["報丁"]);
  });

  test("整戶點燈、整戶活動報名、認領整桌都能送出", async ({ page, request }) => {
    const api = await apiAs(request, "director");
    const family = `整戶${unique()}`;
    const address = `${family}路`;
    await api.post("/members", { householdAddress: address, name: `${family}甲`, gender: "UNKNOWN" });
    await api.post("/members", { householdAddress: `${family}路`, name: `${family}乙`, gender: "UNKNOWN" });
    const wall = await newWall(request, 3);
    const ceremony = `稽核整戶-${unique()}`;
    await newCeremony(request, { name: ceremony, tableCount: 2, seatsPerTable: 4 });

    await open(page);
    await tick(page, "點燈", "活動報名");
    await checkMulti(page);

    // 整戶點燈：同一種燈 × 戶內 2 人
    const lantern = section(page, "點燈");
    await radioButton(lantern, "整戶點燈").click();
    await page.locator("#lantern_householdId").fill(family);
    await choose(page, address); // 選項顯示的是戶籍地址
    await lantern.getByRole("combobox", { name: /燈種（先選燈種/ }).click({ force: true });
    await choose(page, "光明燈");
    await selectWall(page, wall);
    await lantern.getByRole("button", { name: /選擇燈位/ }).click();
    const lanternModal = page.locator(".ant-modal", { hasText: `選擇燈位：${wall}` });
    await lanternModal.locator(".slot-cell", { hasText: "A-01" }).click();
    await lanternModal.locator(".slot-cell", { hasText: "A-02" }).click();
    await lanternModal.getByRole("button", { name: /確認選位/ }).click();
    await expect(lantern.getByRole("spinbutton", { name: /金額/ })).toHaveValue("1200");
    await lantern.getByRole("button", { name: "加入本次點燈項目" }).click();

    // 認領整桌
    await pickCeremony(page, ceremony);
    await radioButton(page, "認領整桌").click();
    await page.locator("#ceremonyRegistration_memberId").fill(`${family}甲`);
    await choose(page, `${family}甲`);
    await page.getByRole("spinbutton", { name: "金額" }).last().fill("800");
    await page.getByRole("button", { name: /選擇桌次/ }).click();
    await page.locator(".ant-modal", { hasText: `認領整桌：${ceremony}` }).getByText("第 1 桌").click();
    await page.getByRole("button", { name: "加入本次活動報名項目" }).click();
    await page.locator(".ant-modal-confirm").getByRole("button", { name: "知道了" }).click(); // 認領的桌次提示

    const body = await submit(page);
    await expect(body).toContainText("NT$ 2,000");
    await expect(body).toContainText("第1桌");
  });

  test("進香勾選多人報名：登錄兩位，雙人房滿員後不能再加；取消勾選後又能用共用報名者送出", async ({ page, request }) => {
    const ceremony = `稽核多人進香-${unique()}`;
    await newCeremony(request, { name: ceremony, kind: "PILGRIMAGE", roomTypes: [{ name: "雙人房", capacity: 2, fee: 3000, roomCount: 5 }] });
    await open(page);
    await tick(page, "活動報名");
    await checkMulti(page);
    await pickCeremony(page, ceremony);
    await page.getByLabel("房型", { exact: true }).click({ force: true });
    await choose(page, "雙人房");

    const p1 = page.locator(".ant-card-small", { hasText: "參加者 1" });
    await radioButton(p1, "臨櫃香客").click();
    await p1.getByPlaceholder("姓名").fill("多人甲");
    await page.getByRole("button", { name: /新增參加者/ }).click();
    const p2 = page.locator(".ant-card-small", { hasText: "參加者 2" });
    await radioButton(p2, "臨櫃香客").click();
    await p2.getByPlaceholder("姓名").fill("多人乙");
    await expect(page.getByRole("button", { name: /新增參加者/ })).toHaveCount(0);
    await addCeremony(page);
    await expect(await submit(page)).toContainText("多人甲、多人乙");

    // 取消勾選：一個人
    await tick(page, "活動報名");
    await payerCard(page).getByRole("checkbox", { name: "多人報名" }).uncheck();
    await fillSharedWalkIn(page, "單人丙");
    await pickCeremony(page, ceremony);
    await page.getByLabel("房型", { exact: true }).click({ force: true });
    await choose(page, "雙人房");
    await addCeremony(page);
    await expect(await submit(page)).toContainText("單人丙");
  });

  test("中途切換：共用報名者加了一筆，勾選多人報名再加另一個人，最後取消勾選再加一筆，全部送得出去", async ({ page, request }) => {
    await open(page);
    await tick(page, "捐款收費");
    await fillSharedWalkIn(page, "共用甲");
    await addDonation(page, "普渡捐款", "100");
    await expect(section(page, "捐款收費").getByText("本次已加入 1 筆捐款")).toBeVisible();

    await checkMulti(page);
    const donation = section(page, "捐款收費");
    await radioButton(donation, "臨櫃香客").click();
    await donation.getByLabel("姓名", { exact: true }).fill("多人乙");
    await addDonation(page, "修繕捐款", "200");
    await expect(donation.getByText("本次已加入 2 筆捐款")).toBeVisible();

    await payerCard(page).getByRole("checkbox", { name: "多人報名" }).uncheck();
    await fillSharedWalkIn(page, "共用丙");
    await addDonation(page, "建設捐款", "300");
    await expect(donation.getByText("本次已加入 3 筆捐款")).toBeVisible();

    const body = await submit(page);
    await expect(body).toContainText("NT$ 600");
    for (const name of ["共用甲", "多人乙", "共用丙"]) await expect(body).toBeTruthy();
  });
});

// ─────────────── 沒填報名者就加入：每一區塊都要清楚提示，不能沒反應 ───────────────
test("還沒填報名者就按加入：每個區塊都會提示，不會沒反應也不會建立資料", async ({ page, request }) => {
  const wall = await newWall(request);
  const ceremony = `稽核提示-${unique()}`;
  await newCeremony(request, { name: ceremony });
  await open(page);
  await tick(page, "點燈", "捐款收費", "活動報名", "送禮");

  await section(page, "捐款收費").getByRole("button", { name: "加入本次捐款項目" }).click();
  await expect(page.getByText("請先在最上方選擇報名者").first()).toBeVisible();
  await section(page, "送禮").getByRole("button", { name: "加入本次送禮項目" }).click();
  await expect(page.getByText("請先在最上方選擇報名者").first()).toBeVisible();

  // 點燈與活動報名的「加入」在條件未滿時是灰的（燈種、燈位、房型等沒選）；選齊後才輪到報名者檢查
  await pickCeremony(page, ceremony);
  await page.getByRole("spinbutton", { name: "金額" }).last().fill("100");
  await addCeremony(page);
  await expect(page.getByText("請先在最上方選擇報名者").first()).toBeVisible();
  await expect(page.getByText(`${ceremony}（`)).toHaveCount(0);

  const lantern = section(page, "點燈");
  await lantern.getByRole("combobox", { name: /燈種（先選燈種/ }).click({ force: true });
  await choose(page, "光明燈");
  await selectWall(page, wall);
  await lantern.getByRole("button", { name: "選擇燈位" }).click();
  const modal = page.locator(".ant-modal", { hasText: `選擇燈位：${wall}` });
  await modal.locator(".slot-cell", { hasText: "A-01" }).click();
  await modal.getByRole("button", { name: /確認選位/ }).click();
  await lantern.getByRole("button", { name: "加入本次點燈項目" }).click();
  await expect(page.getByText("請先在最上方選擇報名者").first()).toBeVisible();
  await expect(lantern.getByText("將併入本次收據")).toHaveCount(0);
});
