export enum UserRole {
  VOLUNTEER = "VOLUNTEER", // 志工/櫃台人員
  FINANCE = "FINANCE", // 財務人員
  DIRECTOR = "DIRECTOR", // 總幹事/主委
  DATA_ENTRY = "DATA_ENTRY", // 資料建檔人員：只能新增信徒與戶籍資料
  REGISTRAR = "REGISTRAR", // 報名櫃檯人員：可辦理活動報名（含點燈/捐款/送禮）、新增信徒與戶籍資料、查看每日結帳
  /** 唯讀帳號：可檢視所有頁面與資料，但不論任何端點一律禁止非 GET 請求（見 RolesGuard），供外部人員參觀系統使用 */
  VIEWER = "VIEWER",
}

export enum MemberTagType {
  GENERAL = "GENERAL", // 一般信徒
  LEGAL_MEMBER = "LEGAL_MEMBER", // 合法信徒
}

export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  UNKNOWN = "UNKNOWN",
}

export enum LanternSlotStatus {
  EMPTY = "EMPTY", // 空燈位（綠）
  CLAIMED = "CLAIMED", // 已認領（紅）
}

/** 「點燈內容」下拉式選單可複選的固定選項；太歲燈牆固定鎖定為 TAISUI_LANTERN_TYPE，不受此清單限制 */
export const LANTERN_TYPE_OPTIONS = ["光明燈", "平安燈", "財神燈", "文昌燈", "消災燈"];

/** 太歲燈牆（isTaisuiWall）唯一可選的點燈內容 */
export const TAISUI_LANTERN_TYPE = "太歲燈";

export enum DonationType {
  YOU_XIANG = "YOU_XIANG", // 油香錢（已停用，僅供歷史資料顯示）
  SUI_XI = "SUI_XI", // 隨喜（已停用，僅供歷史資料顯示）
  CEREMONY = "CEREMONY", // 法會（已停用，僅供歷史資料顯示）
  OTHER = "OTHER", // 其他（已停用，僅供歷史資料顯示）
  GENERAL = "GENERAL", // 一般捐款
  PUDU = "PUDU", // 普渡捐款
  PILGRIMAGE = "PILGRIMAGE", // 進香捐款
  RENOVATION = "RENOVATION", // 修繕捐款
  CONSTRUCTION = "CONSTRUCTION", // 建設捐款
}

/** 新增捐款時可選的項目（舊項目僅保留於歷史資料顯示，不再開放選用） */
export const SELECTABLE_DONATION_TYPES: DonationType[] = [
  DonationType.GENERAL,
  DonationType.PUDU,
  DonationType.PILGRIMAGE,
  DonationType.RENOVATION,
  DonationType.CONSTRUCTION,
];

export enum GiftType {
  FLOWERS = "FLOWERS", // 鮮花
  LONGEVITY = "LONGEVITY", // 壽桃壽麵
  WATER = "WATER", // 水
  BEER = "BEER", // 啤酒
  DRINKS = "DRINKS", // 飲料
  OTHER = "OTHER", // 其他
}

export enum ReceiptStatus {
  ISSUED = "ISSUED",
  VOIDED = "VOIDED",
}

export enum ReceiptSourceType {
  LANTERN_CLAIM = "LANTERN_CLAIM",
  DONATION = "DONATION",
  CEREMONY_REGISTRATION = "CEREMONY_REGISTRATION",
  COMBINED = "COMBINED", // 活動報名頁一次勾選多項活動，合併開立的單張收據
  /** 僅用於合併收據 items[].sourceRefs 的來源標記，送禮本身沒有獨立收據 */
  GIFT = "GIFT",
}

export enum CeremonyFeeMode {
  FREE_WILL = "FREE_WILL", // 隨喜
  FIXED_AMOUNT = "FIXED_AMOUNT", // 固定金額
}

export enum InventoryTransactionType {
  IN = "IN", // 進貨
  OUT = "OUT", // 領用/銷售
}

export enum LedgerEntryType {
  INCOME = "INCOME",
  EXPENSE = "EXPENSE",
}

export enum LedgerEntryCategory {
  // 收入
  PAPER_MONEY_SALES = "PAPER_MONEY_SALES", // 金紙販售
  EXTERNAL_DONATION = "EXTERNAL_DONATION", // 外部捐款
  OTHER_INCOME = "OTHER_INCOME",
  // 支出
  UTILITIES = "UTILITIES", // 水電
  RITUAL_MASTER_FEE = "RITUAL_MASTER_FEE", // 法師車馬費
  REPAIR = "REPAIR", // 修繕費
  OFFERING_SUPPLIES = "OFFERING_SUPPLIES", // 祭品採購
  OTHER_EXPENSE = "OTHER_EXPENSE",
  /** 已停用，不再開放選用：撥補零用金的特殊邏輯已改綁定到 PETTY_CASH_REPLENISHMENT，僅保留供歷史資料顯示 */
  PETTY_CASH = "PETTY_CASH",
  SALARY = "SALARY", // 薪資支出
  PETTY_CASH_REPLENISHMENT = "PETTY_CASH_REPLENISHMENT", // 零用金撥補（撥補零用金：選它會自動帶入預設金額，並計入「剩餘零用金」餘額）
}

export enum LedgerEntryStatus {
  PENDING = "PENDING", // 待審核
  APPROVED = "APPROVED", // 已核准
  REJECTED = "REJECTED", // 已駁回
}

/**
 * 流水帳分類欄位實際存放的是自由輸入文字（前端 AutoComplete 存的是中文顯示字，而非上面的 enum 鍵值），
 * 故「零用金撥補」分類需要一個前後端共用的字面字串常數才能正確比對，不能直接用 LedgerEntryCategory.PETTY_CASH_REPLENISHMENT。
 */
export const PETTY_CASH_CATEGORY_LABEL = "零用金撥補";
/** 撥補零用金的功能已改綁定到「零用金撥補」，此字面字串僅保留供比對歷史上用舊版「零用金」分類建立的撥補紀錄，
 *  確保「剩餘零用金」餘額計算不會漏算這些舊資料 */
export const PETTY_CASH_LEGACY_CATEGORY_LABEL = "零用金";
