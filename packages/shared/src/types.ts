import {
  CeremonyFeeMode,
  DonationType,
  Gender,
  GiftType,
  InventoryTransactionType,
  LanternSlotStatus,
  LedgerEntryStatus,
  LedgerEntryType,
  MemberTagType,
  ReceiptSourceType,
  ReceiptStatus,
  UserRole,
} from "./enums";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

/** 使用者自己編輯自己的帳號資料（不含角色/啟用狀態，那些只有總幹事能在帳號管理頁調整） */
export interface UpdateOwnProfileRequest {
  username?: string;
  displayName?: string;
}

export interface ChangeOwnPasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UserAccountDto {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export interface CreateUserAccountRequest {
  username: string;
  password: string;
  displayName: string;
  role: UserRole;
}

export interface UpdateUserAccountRequest {
  username?: string;
  displayName?: string;
  role?: UserRole;
  active?: boolean;
}

export interface ResetUserPasswordRequest {
  password: string;
}

export interface HouseholdDto {
  id: string;
  address: string;
  phone: string | null;
  headMemberId: string | null;
  createdAt: string;
  /** 僅列表查詢會帶此欄位：該戶目前有幾位信徒 */
  memberCount?: number;
}

export interface MemberDto {
  id: string;
  householdId: string;
  name: string;
  phone: string | null;
  /** 信徒本人的地址，可能與所屬戶籍地址不同 */
  address: string | null;
  gender: Gender;
  birthDateSolar: string | null; // ISO date, e.g. 1970-01-01
  birthDateLunar: string | null; // e.g. "1969年臘月廿三"
  zodiac: string | null; // e.g. "雞"
  isZodiacClashYear: boolean;
  tags: MemberTagType[];
  createdAt: string;
}

export interface MemberHistoryEntryDto {
  type: "DONATION" | "LANTERN_CLAIM";
  id: string;
  description: string;
  amount: number;
  occurredAt: string;
}

export interface CreateHouseholdRequest {
  address: string;
  phone?: string;
}

export interface UpdateHouseholdRequest {
  address?: string;
  phone?: string;
}

export interface CreateMemberRequest {
  /** 戶籍地址：跟現有戶籍地址完全相同就自動歸入該戶，否則自動建立新戶籍 */
  householdAddress: string;
  name: string;
  phone?: string;
  address?: string;
  gender: Gender;
  birthDateSolar?: string;
  /** 農曆生日文字：留空時依國曆生日自動換算；有填寫則以此為準（供只知道農曆生日、或需手動修正換算結果時使用） */
  birthDateLunar?: string;
  tags?: MemberTagType[];
}

export interface UpdateMemberRequest {
  name?: string;
  phone?: string;
  address?: string;
  gender?: Gender;
  birthDateSolar?: string;
  /** 農曆生日文字：留空時依國曆生日自動換算；有填寫則以此為準（供只知道農曆生日、或需手動修正換算結果時使用） */
  birthDateLunar?: string;
  tags?: MemberTagType[];
  /** 提供此欄位可將信徒轉移到另一個戶籍（供「新增成員」搜尋既有信徒加入本戶使用） */
  householdId?: string;
}

/** 一鍵匯入信徒資料：一列代表一位信徒，戶籍地址相同者會歸到同一個戶籍（沿用既有戶籍或建立新戶籍） */
export interface BulkImportMemberRow {
  /** 戶號：有填的話優先以此分組歸戶（即使地址欄文字略有差異也歸同一戶），沒有才用地址比對 */
  householdKey?: string;
  /** 戶籍地址，用於分組歸戶（同戶籍者填一樣的地址即可）；也會存成戶籍的地址欄位 */
  householdAddress: string;
  householdPhone?: string;
  name: string;
  phone?: string;
  /** 信徒本人的地址，留空則視為與戶籍地址相同 */
  address?: string;
  /** 接受中文（男/女）、英文（MALE/FEMALE）或留空 */
  gender?: string;
  birthDateSolar?: string;
  /** 標籤名稱，逗號分隔，例如「爐主,頭家」 */
  tags?: string;
}

export interface BulkImportMembersRequest {
  rows: BulkImportMemberRow[];
}

export interface BulkImportRowError {
  rowNumber: number;
  name: string;
  message: string;
}

export interface BulkImportMembersResponse {
  successCount: number;
  failedRows: BulkImportRowError[];
}

export interface LanternWallDto {
  id: string;
  templeId: string;
  name: string;
  year: number;
  slotPrice: number;
  slotCount: number;
  claimedCount: number;
  totalAmount: number;
  /** 太歲燈牆：點燈內容固定鎖定為「太歲燈」，不受一般點燈內容下拉選單限制 */
  isTaisuiWall: boolean;
}

export interface CreateLanternWallRequest {
  templeId: string;
  name: string;
  year: number;
  slotPrice: number;
  isTaisuiWall?: boolean;
}

/** 修改燈牆的點燈內容（例如「光明燈」「平安燈」）與是否為太歲燈牆 */
export interface UpdateLanternWallRequest {
  name: string;
  isTaisuiWall?: boolean;
}

export interface SlotPositionRequest {
  row: number;
  column: number;
}

export interface GenerateLanternSlotsRequest {
  prefix: string;
  positions: SlotPositionRequest[];
}

export interface LanternSlotDto {
  id: string;
  wallId: string;
  code: string;
  /** 建立時在畫布上點選的排號（同一排的燈位共用同一個 row），供「燈位表」照原始形狀還原排列 */
  row: number;
  /** 建立時在畫布上點選的格號 */
  column: number;
  status: LanternSlotStatus;
  claim?: {
    id: string;
    memberId: string | null;
    memberName: string;
    wishText: string | null;
    /** 疏文：點燈時的正式祈福文書內容，與「祈願內容」分開存放 */
    petitionText: string | null;
    /** 點燈內容（例如「光明燈」「平安燈」），未填則收據上顯示燈牆名稱 */
    lanternType: string | null;
    amount: number;
  };
}

export interface ClaimLanternSlotRequest {
  slotId: string;
  memberId?: string;
  walkInName?: string;
  wishText?: string;
  petitionText?: string;
  /** 點燈內容（例如「光明燈」「平安燈」），未填則收據上顯示燈牆名稱 */
  lanternType?: string;
  amount: number;
}

/** 編輯已認領燈位的資料（供修正輸入錯誤使用）；金額已核發收據，不開放在此修改 */
export interface UpdateLanternClaimRequest {
  memberId?: string | null;
  walkInName?: string | null;
  wishText?: string | null;
  petitionText?: string | null;
  /** 點燈內容（例如「光明燈」「平安燈」），未填則收據上顯示燈牆名稱 */
  lanternType?: string | null;
}

/** 整戶點燈：一次把整戶（依人數）分別認領同一面燈牆上的多個燈位；不同燈牆各自呼叫此 API，故同一戶可在多面燈牆上各自點滿整戶人數 */
export interface ClaimHouseholdLanternSlotsRequest {
  wallId: string;
  householdId: string;
  slotIds: string[];
  amount: number;
}

export interface CreateDonationRequest {
  templeId: string;
  memberId?: string;
  walkInName?: string;
  type: DonationType;
  amount: number;
  note?: string;
  /** 自訂捐款項目名稱／數量：僅總幹事可填寫，其餘角色送出會被拒絕 */
  customItem?: string;
  quantity?: number;
  /** 指定捐給某個活動時填寫：這筆捐款會獨立歸入該活動的收入，不計入一般捐款分類統計 */
  ceremonyId?: string;
}

export interface DonationDto {
  id: string;
  templeId: string;
  memberId: string | null;
  walkInName: string | null;
  type: DonationType;
  amount: number;
  customItem: string | null;
  quantity: number | null;
  ceremonyId: string | null;
  createdAt: string;
}

export interface GiftItemRequest {
  giftType: GiftType;
  quantity: number;
}

export interface CreateGiftRequest {
  templeId: string;
  memberId?: string;
  walkInName?: string;
  /** 可一次選擇多個品項並各自填寫數量，各自建立一筆送禮紀錄，收據上合併成單一「送禮」項目 */
  items: GiftItemRequest[];
}

export interface GiftDto {
  id: string;
  templeId: string;
  memberId: string | null;
  walkInName: string | null;
  giftType: GiftType;
  quantity: number;
  createdAt: string;
}

export interface ReceiptItemDto {
  description: string;
  amount: number;
  /** 補充說明（例如法會座位號碼），收據上會印在項目下方 */
  note?: string;
  /** 目前僅法會報名項目會標記，供財務報表分類統計使用（description 已改為法會名稱，不再帶有可辨識來源的固定文字） */
  category?: "CEREMONY_REGISTRATION";
  /** 此合併收據項目對應的來源紀錄（點燈/捐款/法會報名/送禮），供作廢或刪除收據時回頭清除對應資料、以及報表排除已作廢項目使用 */
  sourceRefs?: { sourceType: ReceiptSourceType; sourceId: string }[];
}

export interface ReceiptDto {
  id: string;
  receiptNo: string;
  sourceType: ReceiptSourceType;
  sourceId: string;
  amount: number;
  status: ReceiptStatus;
  issuedByName: string;
  createdAt: string;
  /** 僅合併收據（COMBINED）會有值：開立時直接記錄的付款人姓名 */
  payerName?: string | null;
  /** 僅合併收據（COMBINED）會有值：本張收據涵蓋的各活動項目與金額 */
  items?: ReceiptItemDto[] | null;
}

export interface ReceiptDetailDto extends ReceiptDto {
  payerName: string;
  description: string;
}

export interface ReceiptCertificateDataDto {
  receiptNo: string;
  amount: number;
  status: ReceiptStatus;
  createdAt: string;
  issuedByName: string;
  payerName: string;
  items?: ReceiptItemDto[] | null;
  templeName: string;
  committeeName: string;
  address: string | null;
  phone: string | null;
  registrationNo: string | null;
  taxId: string | null;
  chairmanTitle: string;
}

export interface VoidReceiptRequest {
  reason: string;
}

export interface SlotClaimedEvent {
  wallId: string;
  slot: LanternSlotDto;
}

export interface LedgerEntryDto {
  id: string;
  templeId: string;
  type: LedgerEntryType;
  category: string;
  amount: number;
  description: string | null;
  occurredAt: string; // ISO date
  status: LedgerEntryStatus;
  /** 是否為「從零用金支出」：此筆支出改由零用金支付，不計入總帳（避免與零用金撥補重複計算） */
  isPettyCash: boolean;
  /** 列入活動計算時填寫：這筆流水帳項目會額外統計進該活動的支出，仍照常計入總帳（與零用金支出不同，不排除） */
  ceremonyId: string | null;
  createdByName: string;
  reviewedByName: string | null;
  reviewedReason: string | null;
  createdAt: string;
}

export interface CreateLedgerEntryRequest {
  templeId: string;
  type: LedgerEntryType;
  category: string;
  amount: number;
  description?: string;
  occurredAt: string; // ISO date
  isPettyCash?: boolean;
  ceremonyId?: string;
}

export interface PettyCashBalanceDto {
  balance: number;
}

export interface ReviewLedgerEntryRequest {
  action: "APPROVE" | "REJECT";
  reason?: string;
}

/**
 * 「審核日誌」日曆單一天的審核狀態彙總：手動流水帳項目依交易日期分組的待審核/已核准/已駁回筆數，
 * 加上當天是否有已開立收據的收入（點燈/捐款/法會報名/送禮），以及當天是否已標記為審核完成。
 */
export interface LedgerAuditDaySummaryDto {
  date: string; // ISO date
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  hasReceiptIncome: boolean;
  audited: boolean;
}

export interface BatchApproveLedgerEntriesRequest {
  ids: string[];
}

export interface BatchApproveLedgerEntriesResponse {
  approvedCount: number;
}

export interface ConfirmAuditRequest {
  templeId: string;
  dates: string[];
}

export interface ConfirmAuditResponse {
  auditedDates: string[];
}

export interface IncomeDetailDto {
  label: string;
  amount: number;
  payerName: string;
  occurredAt: string; // ISO timestamp
  receiptNo: string;
  /** 補充說明（例如送禮的品項與數量），非每筆都有值 */
  note?: string;
}

export interface FinancialReportDto {
  periodLabel: string;
  lanternAndDonationIncome: number;
  lanternIncomeByCategory: { label: string; amount: number }[];
  incomeDetails: IncomeDetailDto[];
  ledgerIncome: number;
  ledgerIncomeByCategory: { category: string; amount: number }[];
  totalIncome: number;
  totalExpense: number;
  expenseByCategory: { category: string; amount: number }[];
  netAmount: number;
  pendingEntryCount: number;
  /** 「從零用金支出」的項目：不計入 totalExpense/expenseByCategory/netAmount，僅供在此單獨檢視明細 */
  pettyCashExpenseTotal: number;
  pettyCashExpenseDetails: LedgerEntryDto[];
}

export interface CeremonyReportDto {
  ceremony: CeremonyDto;
  totalAmount: number;
  registrationCount: number;
  registrations: CeremonyRegistrationDto[];
  /** 活動本身的捐款（獨立於報名費，也不計入一般捐款統計） */
  donationTotal: number;
  donations: CeremonyDonationDto[];
  /** 列入活動計算的手動流水帳支出：額外統計進此活動，本身仍照常計入財務報表總支出（不排除） */
  expenseTotal: number;
  expenses: CeremonyExpenseDto[];
}

export interface CeremonyDonationDto {
  payerName: string;
  amount: number;
  note: string | null;
  createdAt: string;
}

export interface CeremonyExpenseDto {
  category: string;
  amount: number;
  description: string | null;
  occurredAt: string;
}

export interface CeremonyDto {
  id: string;
  templeId: string;
  name: string;
  date: string; // ISO date
  feeMode: CeremonyFeeMode;
  fixedAmount: number | null;
  description: string | null;
  tableCount: number | null;
  seatsPerTable: number | null;
  totalSeats: number | null;
  seatsAssigned: number;
  /** 報名期限：超過此日期後，此活動會從「活動報名」頁的選單隱藏 */
  registrationDeadline: string | null;
  /** 供「建立活動」頁列表顯示：此活動至今累積的報名筆數與收款總額 */
  registrationCount: number;
  totalAmount: number;
}

export interface CreateCeremonyRequest {
  templeId: string;
  name: string;
  date: string;
  feeMode: CeremonyFeeMode;
  fixedAmount?: number;
  description?: string;
  tableCount?: number;
  seatsPerTable?: number;
  registrationDeadline?: string;
}

export interface UpdateCeremonyRequest {
  name?: string;
  date?: string;
  feeMode?: CeremonyFeeMode;
  fixedAmount?: number | null;
  description?: string | null;
  tableCount?: number | null;
  seatsPerTable?: number | null;
  registrationDeadline?: string | null;
}

export interface CeremonyRegistrationDto {
  id: string;
  ceremonyId: string;
  ceremonyName: string;
  memberId: string | null;
  walkInName: string | null;
  walkInAddress: string | null;
  participantName: string;
  participantAddress: string | null;
  amount: number;
  wishText: string | null;
  seatNumber: string | null;
  createdAt: string;
  /** 這筆報名對應的收據 id（單筆或合併收據皆可能，找不到時為 null），供「報名名單」查看/刪除收據使用 */
  receiptId: string | null;
}

export interface RegisterCeremonyRequest {
  ceremonyId: string;
  memberId?: string;
  walkInName?: string;
  walkInAddress?: string;
  /** 整戶報名：提供此欄位時，會為該戶籍下每一位信徒各自建立一筆報名紀錄 */
  householdId?: string;
  amount: number;
  wishText?: string;
  /** 手動選位時指定的座位流水號（1 起算）；未提供時由系統依序自動配發 */
  seatIndex?: number;
  /** 整戶報名的手動選位：座位數量必須與戶內人數相同，依序對應每一位信徒 */
  householdSeatIndexes?: number[];
  /** 認領整桌：提供此欄位時，該桌所有座位都會被保留給同一位報名者，收據上只印「第X桌」 */
  tableNumber?: number;
  /** 此人不需要座位（例如純捐款/隨喜，不會實際入座），即使活動有設定座位也不會佔用任何座位 */
  noSeatNeeded?: boolean;
}

/** 供「活動報名」頁一次報名多個活動使用：單筆呼叫立即建立報名紀錄，收據留待與其他活動合併開立 */
export interface RegisterCeremonyCombinedResponse {
  registration?: CeremonyRegistrationDto;
  /** 整戶報名時，該戶籍下每一位信徒各自的報名紀錄 */
  registrations?: CeremonyRegistrationDto[];
  payerName: string;
  description: string;
  note?: string;
  templeId: string;
}

export interface CeremonySeatDto {
  seatIndex: number;
  tableNumber: number;
  seatInTable: number;
  status: "EMPTY" | "TAKEN";
  participantName?: string;
}

/**
 * 活動報名頁：一次勾選多個活動時，合併送出並開立單張收據。
 * 點燈／法會報名在按下「加入」時只暫存在前端，尚未寫入資料庫；送出當下才真正卡位／配位並建立紀錄，
 * 避免「加入後忘記送出」留下沒有收據、卻佔用座位／燈位的孤兒資料。
 */
export interface SubmitActivitiesRequest {
  donation?: CreateDonationRequest;
  gift?: CreateGiftRequest;
  /** 尚未建立紀錄的點燈認領（單人） */
  pendingLanternClaims?: ClaimLanternSlotRequest[];
  /** 尚未建立紀錄的整戶點燈 */
  pendingHouseholdLanternClaims?: ClaimHouseholdLanternSlotsRequest[];
  /** 尚未建立紀錄的法會報名（單人／整戶／認領整桌皆可） */
  pendingCeremonyRegistrations?: RegisterCeremonyRequest[];
  /** 當本次送出的項目都沒有可推得的付款人姓名時，用來填入收據的付款人姓名 */
  fallbackPayerName?: string;
  /** 當本次送出的項目都沒有可推得的所屬廟宇時，用來填入收據所屬廟宇 */
  fallbackTempleId?: string;
}

export interface SubmitActivitiesResponse {
  receipt: ReceiptDto;
  donation?: DonationDto;
  gifts?: GiftDto[];
  ceremonyRegistration?: CeremonyRegistrationDto;
  /** 整戶報名時，該戶籍下每一位信徒各自的報名紀錄 */
  ceremonyRegistrations?: CeremonyRegistrationDto[];
}

export interface InventoryItemDto {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  updatedAt: string;
}

export interface CreateInventoryItemRequest {
  name: string;
  unit: string;
  lowStockThreshold: number;
  initialStock?: number;
}

export interface AdjustInventoryStockRequest {
  type: InventoryTransactionType;
  quantity: number;
  note?: string;
}

export interface InventoryTransactionDto {
  id: string;
  itemId: string;
  itemName: string;
  type: InventoryTransactionType;
  quantity: number;
  note: string | null;
  createdByName: string;
  createdAt: string;
}

/** 多廟支援：切換器用的簡易廟宇清單項目 */
export interface TempleDto {
  id: string;
  name: string;
}

export interface TempleSettingsDto {
  id: string;
  name: string;
  templeName: string;
  address: string | null;
  phone: string | null;
  registrationNo: string | null;
  taxId: string | null;
  committeeName: string | null;
  chairmanTitle: string;
  chairmanName: string | null;
  templeSealImagePath: string | null;
  chairmanSealImagePath: string | null;
}

export interface UpdateTempleSettingsRequest {
  name?: string;
  templeName?: string;
  address?: string;
  phone?: string;
  registrationNo?: string;
  taxId?: string;
  committeeName?: string;
  chairmanTitle?: string;
  chairmanName?: string;
}
