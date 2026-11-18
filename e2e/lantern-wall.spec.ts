import { expect, test } from "@playwright/test";
import * as ExcelJSModule from "../apps/web/node_modules/exceljs";
import { apiAs, loginWithTemple, radioButton } from "./helpers";

// exceljs 是 CommonJS 套件，依編譯方式不同可能包在 default 底下
const ExcelJS = ((ExcelJSModule as unknown as { default?: typeof ExcelJSModule }).default ?? ExcelJSModule) as typeof import("exceljs");

test("每面燈牆可以匯出燈位表 Excel：依位置排列、編號在上姓名在下、外圍粗黑框、排與排之間空一列", async ({ page, request }) => {
  const api = await apiAs(request, "director");
  const templeId = await api.templeId();
  const name = `匯出燈牆-${Date.now()}`;
  const wall = await api.post("/lantern/walls", { templeId, name, year: 2026, slotPrice: 600 });
  // 第 1 排三格、第 2 排只有左右兩格（中間是空位）
  await api.post(`/lantern/walls/${wall.id}/slots`, {
    prefix: "A",
    positions: [
      { row: 1, column: 1, gridRow: 1, gridColumn: 1 },
      { row: 1, column: 2, gridRow: 1, gridColumn: 2 },
      { row: 1, column: 3, gridRow: 1, gridColumn: 3 },
      { row: 2, column: 1, gridRow: 2, gridColumn: 1 },
      { row: 2, column: 3, gridRow: 2, gridColumn: 3 },
    ],
  });
  const slots = (await api.get(`/lantern/walls/${wall.id}/slots`)) as { id: string; code: string; gridRow: number; gridColumn: number }[];
  const at = (r: number, c: number) => slots.find((s) => s.gridRow === r && s.gridColumn === c)!;
  await api.post("/lantern/claims", { slotId: at(1, 1).id, lanternType: "光明燈", walkInName: "龔忠欣", amount: 600 });
  await api.post("/lantern/claims", { slotId: at(2, 3).id, lanternType: "光明燈", walkInName: "龔泓儒", amount: 600 });

  await loginWithTemple(page, "director");
  await page.locator(".ant-menu").getByText("建立活動", { exact: true }).click();
  await radioButton(page, /^點燈牆$/).click();
  const row = page.locator(".ant-table-row", { hasText: name });
  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("button", { name: "匯出燈位 Excel" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`燈位表_${name}_2026.xlsx`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const sheet = workbook.worksheets[0];
  const value = (r: number, c: number) => sheet.getCell(r, c).value ?? null;

  expect(value(1, 1)).toBe(`${name}（2026 年）燈位表　已點 2 / 5 盞`);
  // 第 1 排：編號一列、姓名一列
  expect([value(3, 1), value(3, 2), value(3, 3)]).toEqual([at(1, 1).code, at(1, 2).code, at(1, 3).code]);
  expect([value(4, 1), value(4, 2), value(4, 3)]).toEqual(["龔忠欣", "", ""]);
  // 排與排之間空一列
  expect([value(5, 1), value(5, 2), value(5, 3)]).toEqual([null, null, null]);
  // 第 2 排：中間沒有燈位就留白
  expect([value(6, 1), value(6, 2), value(6, 3)]).toEqual([at(2, 1).code, null, at(2, 3).code]);
  expect([value(7, 1), value(7, 2), value(7, 3)]).toEqual(["", null, "龔泓儒"]);

  // 編號與姓名兩格外圍是粗框
  const codeBorder = sheet.getCell(3, 1).border;
  const nameBorder = sheet.getCell(4, 1).border;
  expect([codeBorder.top?.style, codeBorder.left?.style, codeBorder.right?.style]).toEqual(["medium", "medium", "medium"]);
  expect([nameBorder.bottom?.style, nameBorder.left?.style, nameBorder.right?.style]).toEqual(["medium", "medium", "medium"]);
  expect(Object.keys(sheet.getCell(6, 2).border ?? {})).toEqual([]);
});
