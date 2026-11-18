import { APIRequestContext, expect, Page } from "@playwright/test";

export const API = "http://localhost:3101/api";
export const PASSWORD = "pass1234";

/** 直接呼叫後端 API（用來準備測試資料或驗證結果），回傳帶好登入 token 的小工具 */
export async function apiAs(request: APIRequestContext, username: string) {
  const login = await request.post(`${API}/auth/login`, { data: { username, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  return {
    get: async (path: string) => (await request.get(`${API}${path}`, { headers })).json(),
    post: async (path: string, data: object) => {
      const res = await request.post(`${API}${path}`, { headers, data });
      const text = await res.text();
      expect(res.ok(), `${path} → ${res.status()} ${text}`).toBeTruthy();
      // 有些 API 成功時不回傳內容（例如產生燈位），空的就不解析
      return text ? JSON.parse(text) : undefined;
    },
    templeId: async () => (await (await request.get(`${API}/temples`, { headers })).json())[0].id as string,
  };
}

/** 從登入畫面輸入帳號密碼登入 */
export async function login(page: Page, username: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("帳號").fill(username);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: /登\s*入/ }).click();
}

/** 登入並把右上角的廟別切到「中埔」（大部分頁面要先選定廟宇才能操作） */
export async function loginWithTemple(page: Page, username: string) {
  await login(page, username);
  await expect(page.getByRole("button", { name: /登\s*出/ })).toBeVisible();
  await page.locator(".ant-layout-header .ant-select").click();
  await page.locator(".ant-select-item-option", { hasText: "中埔" }).click();
}

/** antd 下拉選單：點開指定標籤的欄位，選包含指定文字的選項 */
export async function selectOption(page: Page, label: string, optionText: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: optionText }).click();
}

/** antd 的按鈕式單選（Radio.Button） */
export function radioButton(scope: Page | ReturnType<Page["locator"]>, text: string | RegExp) {
  return scope.locator("label.ant-radio-button-wrapper", { hasText: text });
}

/** 今天之後第 offset 天，YYYY-MM-DD */
export function futureDate(offsetDays = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
