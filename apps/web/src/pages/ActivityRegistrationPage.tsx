import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { FileExcelOutlined, FilePdfOutlined, PrinterOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import {
  CeremonyDto,
  CeremonyFeeMode,
  CeremonyKind,
  CeremonySession,
  CeremonySeatDto,
  ClaimHouseholdLanternSlotsRequest,
  ClaimLanternSlotRequest,
  CreateDonationRequest,
  CreateGiftRequest,
  DonationType,
  GiftType,
  LanternSlotDto,
  LanternSlotStatus,
  PILGRIMAGE_BUS_SEAT_COUNT,
  ReceiptDetailDto,
  ReceiptDto,
  ReceiptSourceType,
  ReceiptStatus,
  RegisterCeremonyRequest,
  SlotClaimedEvent,
  SubmitActivitiesRequest,
  TAISUI_LANTERN_TYPE,
  UserRole,
} from "@tms/shared";
import { deleteReceipt, getLanternTypes, getWallSlots, listWalls, voidReceipt } from "../api/lantern";
import { checkDuplicateRegistrations, getCeremonySeats, listCeremonies } from "../api/ceremony";
import { submitActivities } from "../api/activities";
import { getHouseholdMembers } from "../api/households";
import { MemberSelect } from "../components/MemberSelect";
import { HouseholdSelect } from "../components/HouseholdSelect";
import { openPrintWindow } from "../api/client";
import { getReceiptDetails } from "../api/print";
import { useAuth } from "../context/AuthContext";
import { ALL_TEMPLES, useTemple } from "../context/TempleContext";
import { exportReceiptCertificatePdf, exportRowsToExcel } from "../utils/export";
import { SHOW_PILGRIMAGE_BUS } from "../utils/features";
import { lanternCellWidth } from "../utils/lanternCell";

type ActivityKey = "lantern" | "donation" | "ceremony" | "gift";

const activityOptions: { label: string; value: ActivityKey }[] = [
  { label: "點燈", value: "lantern" },
  { label: "捐款收費", value: "donation" },
  { label: "活動報名", value: "ceremony" },
  { label: "送禮", value: "gift" },
];

/** 「最近收據」活動篩選選單用：活動類型對應到收據的 sourceType（合併收據則另外用 items[].sourceRefs 判斷是否涵蓋） */
const activityKeyToSourceType: Record<ActivityKey, ReceiptSourceType> = {
  lantern: ReceiptSourceType.LANTERN_CLAIM,
  donation: ReceiptSourceType.DONATION,
  ceremony: ReceiptSourceType.CEREMONY_REGISTRATION,
  gift: ReceiptSourceType.GIFT,
};
const receiptActivityFilterOptions: { label: string; value: ActivityKey | "all" }[] = [
  { label: "全部", value: "all" },
  ...activityOptions,
];

const donationTypeLabel: Partial<Record<DonationType, string>> = {
  [DonationType.GENERAL]: "一般捐款",
  [DonationType.PUDU]: "普渡捐款",
  [DonationType.PILGRIMAGE]: "進香捐款",
  [DonationType.RENOVATION]: "修繕捐款",
  [DonationType.CONSTRUCTION]: "建設捐款",
};

const giftTypeLabel: Record<GiftType, string> = {
  [GiftType.FLOWERS]: "鮮花",
  [GiftType.LONGEVITY]: "壽桃壽麵",
  [GiftType.WATER]: "水",
  [GiftType.BEER]: "啤酒",
  [GiftType.DRINKS]: "飲料",
  [GiftType.OTHER]: "其他",
};

const receiptStatusLabel = (s: ReceiptStatus) => (s === ReceiptStatus.VOIDED ? "已作廢" : "正常");

const receiptDetailHeaders = ["收據編號", "信眾姓名", "項目", "金額", "經辦人", "狀態", "時間"];

function receiptDetailToRow(r: ReceiptDetailDto): (string | number)[] {
  return [
    r.receiptNo,
    r.payerName,
    r.description,
    r.amount,
    r.issuedByName,
    receiptStatusLabel(r.status),
    new Date(r.createdAt).toLocaleString("zh-TW"),
  ];
}

const feeModeLabel: Record<CeremonyFeeMode, string> = {
  [CeremonyFeeMode.FREE_WILL]: "隨喜",
  [CeremonyFeeMode.FIXED_AMOUNT]: "固定金額",
};

/**
 * 「加入」時只暫存在前端，尚未寫入資料庫、尚未卡位；直到最後「送出並開立收據」才真正建立紀錄。
 * 這樣「加入」後忘記送出就不會留下沒有收據、卻佔用座位/燈位的孤兒資料。
 */
type PendingLanternItem = {
  displayLabel: string;
  amount: number;
  single?: ClaimLanternSlotRequest;
  household?: ClaimHouseholdLanternSlotsRequest;
};

/** 進香報名的參加者：已建檔信徒（memberId；memberName 只供畫面顯示）或臨櫃香客（name） */
type PilgrimParticipant = { mode?: "member" | "walkIn"; memberId?: string; memberName?: string; name?: string };

const pilgrimParticipantName = (p?: PilgrimParticipant) =>
  (p?.mode === "walkIn" ? p?.name?.trim() : p?.memberName) ?? "";

type PendingCeremonyItem = {
  displayLabel: string;
  amount: number;
  request: RegisterCeremonyRequest;
};

/** 捐款、送禮「加入」後暫存在前端的項目（送出時才真正建立紀錄並開立收據） */
type PendingDonationItem = { displayLabel: string; amount: number; request: CreateDonationRequest };
type PendingGiftItem = { displayLabel: string; request: CreateGiftRequest };

/** 已加入、尚未送出的項目清單，每筆可以移除 */
function PendingItemsList({
  title,
  items,
  onRemove,
}: {
  title: string;
  items: { label: string; amount?: number }[];
  onRemove: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Alert
      type="success"
      showIcon
      style={{ marginTop: 16 }}
      message={title}
      description={
        <Space direction="vertical" style={{ width: "100%" }}>
          {items.map((item, i) => (
            <Space key={i} align="center" wrap>
              <span>
                {item.label}
                {item.amount != null ? `　NT$ ${item.amount.toLocaleString()}` : ""}
              </span>
              <Button size="small" danger onClick={() => onRemove(i)}>
                移除
              </Button>
            </Space>
          ))}
        </Space>
      }
    />
  );
}

/**
 * 沒有勾選「多人報名」時，整張收據只在最上方填一次報名者，點燈、捐款、活動報名、送禮都沿用這個人。
 * 各區塊仍保留自己的（隱藏）報名者欄位，用這個值同步進去，後面的驗證與送出邏輯完全不用改。
 */
type SharedPayer = { mode: "member" | "walkIn"; memberId?: string; walkInName?: string; name: string; ready: boolean };

const HIDDEN_STYLE = { display: "none" } as const;

function useSyncSharedPayer(form: any, shared: SharedPayer | null, refreshKey: number) {
  useEffect(() => {
    if (!shared) return;
    form.setFieldsValue({
      payerMode: shared.mode,
      memberId: shared.mode === "member" ? shared.memberId : undefined,
      walkInName: shared.mode === "walkIn" ? shared.walkInName : undefined,
    });
    // 加入一筆項目後各區塊會清空自己的報名者欄位，refreshKey（已加入的筆數）變動時再同步回去
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared?.mode, shared?.memberId, shared?.walkInName, refreshKey]);
}

const SHARED_PAYER_WARNING = "請先在最上方選擇報名者（或勾選「多人報名」分別填寫）";

function DonationFields({
  form,
  ceremonies,
  templeId,
  pendingItems,
  onAddPending,
  onRemovePending,
  shared,
}: {
  form: any;
  ceremonies: CeremonyDto[];
  templeId: string;
  shared: SharedPayer | null;
  pendingItems: PendingDonationItem[];
  onAddPending: (item: PendingDonationItem) => void;
  onRemovePending: (index: number) => void;
}) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isDirector = user?.role === UserRole.DIRECTOR;
  const payerMode = Form.useWatch("payerMode", form) ?? "member";
  const ceremonyId = Form.useWatch("ceremonyId", form);
  const [selectedMemberName, setSelectedMemberName] = useState<string | undefined>();
  useSyncSharedPayer(form, shared, pendingItems.length);

  const handleAdd = async () => {
    if (shared && !shared.ready) {
      message.warning(SHARED_PAYER_WARNING);
      return;
    }
    const values = await form.validateFields();
    const payerName = values.payerMode === "walkIn" ? values.walkInName?.trim() : (shared?.name ?? selectedMemberName ?? "");
    const ceremonyName = ceremonies.find((c) => c.id === values.ceremonyId)?.name;
    const typeText = ceremonyName ? `活動捐款（${ceremonyName}）` : (donationTypeLabel[values.type as DonationType] ?? "捐款");
    onAddPending({
      displayLabel: `${payerName}　${typeText}${values.customItem ? `　${values.customItem}${values.quantity ? ` x${values.quantity}` : ""}` : ""}`,
      amount: values.amount,
      request: {
        templeId,
        memberId: values.payerMode === "member" ? values.memberId : undefined,
        walkInName: values.payerMode === "walkIn" ? values.walkInName : undefined,
        type: values.type ?? DonationType.GENERAL,
        amount: values.amount,
        note: values.note,
        customItem: values.customItem,
        quantity: values.quantity,
        ceremonyId: values.ceremonyId || undefined,
      },
    });
    form.resetFields();
    setSelectedMemberName(undefined);
    message.success("已加入本次捐款項目，可以繼續加入下一筆");
  };

  return (
    <Card title="捐款收費">
      <Form form={form} name="donation" layout="vertical">
        <div style={shared ? HIDDEN_STYLE : undefined}>
        <Form.Item label="香客類型" name="payerMode" initialValue="member">
          <Radio.Group>
            <Radio.Button value="member">已建檔信徒</Radio.Button>
            <Radio.Button value="walkIn">臨櫃香客（免建檔）</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {payerMode === "member" ? (
          <Form.Item label="信徒" name="memberId" rules={[{ required: true, message: "請選擇信徒" }]}>
            <MemberSelect onSelectMember={(m) => setSelectedMemberName(m?.name)} />
          </Form.Item>
        ) : (
          <Form.Item label="姓名" name="walkInName" rules={[{ required: true, whitespace: true, message: "請輸入姓名" }]}>
            <Input placeholder="請輸入姓名" />
          </Form.Item>
        )}
        </div>
        <Form.Item
          label="指定活動（選填）"
          name="ceremonyId"
          extra="指定後這筆捐款會獨立歸入該活動的收入，不計入下方「項目」分類統計"
        >
          <Select
            allowClear
            placeholder="不指定（計入一般捐款分類）"
            options={ceremonies.map((c) => ({ value: c.id, label: c.name }))}
            className={ceremonyId ? "ceremony-selected-select" : undefined}
          />
        </Form.Item>
        {ceremonyId ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="已指定活動，此筆捐款將歸類為該活動的捐款收入"
          />
        ) : (
          <Form.Item label="項目" name="type" initialValue={DonationType.GENERAL} rules={[{ required: true }]}>
            <Select options={Object.entries(donationTypeLabel).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        )}
        <Form.Item label="金額" name="amount" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0} size="large" />
        </Form.Item>
        <Form.Item label="備註" name="note">
          <Input />
        </Form.Item>
        {isDirector && (
          <Space.Compact block>
            <Form.Item label="自訂項目名稱（選填，僅總幹事可填寫）" name="customItem" style={{ width: "70%" }}>
              <Input placeholder="例如：平安米" />
            </Form.Item>
            <Form.Item label="數量" name="quantity" style={{ width: "30%" }}>
              <InputNumber style={{ width: "100%" }} min={1} placeholder="例如：5" />
            </Form.Item>
          </Space.Compact>
        )}
        <Button type="primary" ghost block onClick={handleAdd}>
          加入本次捐款項目
        </Button>
      </Form>
      <PendingItemsList
        title={`本次已加入 ${pendingItems.length} 筆捐款（尚未送出）`}
        items={pendingItems.map((i) => ({ label: i.displayLabel, amount: i.amount }))}
        onRemove={onRemovePending}
      />
    </Card>
  );
}

function GiftFields({
  form,
  ceremonies,
  templeId,
  pendingItems,
  onAddPending,
  onRemovePending,
  shared,
}: {
  form: any;
  ceremonies: CeremonyDto[];
  templeId: string;
  shared: SharedPayer | null;
  pendingItems: PendingGiftItem[];
  onAddPending: (item: PendingGiftItem) => void;
  onRemovePending: (index: number) => void;
}) {
  const { message } = App.useApp();
  const payerMode = Form.useWatch("payerMode", form) ?? "member";
  const giftTypes = (Form.useWatch("giftTypes", form) ?? []) as GiftType[];
  const [selectedMemberName, setSelectedMemberName] = useState<string | undefined>();
  useSyncSharedPayer(form, shared, pendingItems.length);

  const handleAdd = async () => {
    if (shared && !shared.ready) {
      message.warning(SHARED_PAYER_WARNING);
      return;
    }
    const values = await form.validateFields();
    const payerName = values.payerMode === "walkIn" ? values.walkInName?.trim() : (shared?.name ?? selectedMemberName ?? "");
    const items = (values.giftTypes as GiftType[]).map((giftType) => ({
      giftType,
      quantity: values.quantities?.[giftType] || 1,
    }));
    const ceremonyName = ceremonies.find((c) => c.id === values.ceremonyId)?.name;
    onAddPending({
      displayLabel: `${payerName}　送禮：${items.map((i) => `${giftTypeLabel[i.giftType]}x${i.quantity}`).join("、")}${ceremonyName ? `（${ceremonyName}）` : ""}`,
      request: {
        templeId,
        memberId: values.payerMode === "member" ? values.memberId : undefined,
        walkInName: values.payerMode === "walkIn" ? values.walkInName : undefined,
        items,
        ceremonyId: values.ceremonyId || undefined,
      },
    });
    form.resetFields();
    setSelectedMemberName(undefined);
    message.success("已加入本次送禮項目，可以繼續加入下一筆");
  };

  return (
    <Card title="送禮">
      <Form form={form} name="gift" layout="vertical">
        <div style={shared ? HIDDEN_STYLE : undefined}>
        <Form.Item label="捐贈者類型" name="payerMode" initialValue="member">
          <Radio.Group>
            <Radio.Button value="member">已建檔信徒</Radio.Button>
            <Radio.Button value="walkIn">臨櫃（免建檔）</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {payerMode === "member" ? (
          <Form.Item label="信徒" name="memberId" rules={[{ required: true, message: "請選擇信徒" }]}>
            <MemberSelect onSelectMember={(m) => setSelectedMemberName(m?.name)} />
          </Form.Item>
        ) : (
          <Form.Item label="姓名" name="walkInName" rules={[{ required: true, whitespace: true, message: "請輸入姓名" }]}>
            <Input placeholder="請輸入姓名" />
          </Form.Item>
        )}
        </div>
        <Form.Item
          label="屬於哪個活動（選填）"
          name="ceremonyId"
          extra="指定後，這份禮會列在該活動報表的「收禮資訊」"
        >
          <Select
            allowClear
            placeholder="不指定"
            options={ceremonies.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item
          label="品項（可複選）"
          name="giftTypes"
          rules={[{ required: true, type: "array", min: 1, message: "請至少選擇一項" }]}
        >
          <Select mode="multiple" options={Object.entries(giftTypeLabel).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        {giftTypes.map((giftType) => (
          <Form.Item
            key={giftType}
            label={`${giftTypeLabel[giftType]} 數量`}
            name={["quantities", giftType]}
            initialValue={1}
            rules={[{ required: true, message: "請輸入數量" }]}
          >
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
        ))}
        <Button type="primary" ghost block onClick={handleAdd}>
          加入本次送禮項目
        </Button>
      </Form>
      <PendingItemsList
        title={`本次已加入 ${pendingItems.length} 筆送禮（尚未送出）`}
        items={pendingItems.map((i) => ({ label: i.displayLabel }))}
        onRemove={onRemovePending}
      />
    </Card>
  );
}

function ReceiptsListCard() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [exportingAll, setExportingAll] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityKey | "all">("all");
  const activitySourceType = activityFilter === "all" ? undefined : activityKeyToSourceType[activityFilter];

  const receiptsQuery = useQuery({
    queryKey: ["receipts", "details", searchQuery, page, pageSize, activityFilter],
    queryFn: () => getReceiptDetails(searchQuery, page, pageSize, activitySourceType),
  });

  const handleSearch = (value: string) => {
    setSearchQuery(value.trim());
    setPage(1);
  };

  const handleActivityFilterChange = (value: ActivityKey | "all") => {
    setActivityFilter(value);
    setPage(1);
  };

  const handleExportAllExcel = async () => {
    setExportingAll(true);
    try {
      const details = await getReceiptDetails(searchQuery, 1, 1000, activitySourceType);
      exportRowsToExcel("收據列表.xlsx", "收據", receiptDetailHeaders, details.items.map(receiptDetailToRow));
    } finally {
      setExportingAll(false);
    }
  };

  const handleExportOneReceiptPdf = async (record: ReceiptDto) => {
    // 單張收據匯出比照感謝狀的內容與版面（跟實際列印出來的一致），而不是簡化表格
    await exportReceiptCertificatePdf(record.id, `感謝狀_${record.receiptNo}.pdf`);
  };

  const handleReprint = async (record: ReceiptDto) => {
    // 補印：開啟跟開立當下一模一樣的列印視窗（80mm 收據格式），供收據遺失或需要多留一份時使用
    await openPrintWindow(`/print/receipt/${record.id}`);
  };

  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => voidReceipt(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      setVoidTarget(null);
      setVoidReason("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReceipt(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      message.success("已永久刪除收據");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "刪除失敗，請重試");
    },
  });

  const canVoid = user?.role === UserRole.FINANCE || user?.role === UserRole.DIRECTOR;
  const canDelete = user?.role === UserRole.DIRECTOR;

  return (
    <>
      <Card
        title="最近收據"
        extra={
          <Space>
            <Select
              style={{ width: 120 }}
              value={activityFilter}
              onChange={handleActivityFilterChange}
              options={receiptActivityFilterOptions}
            />
            <Input.Search
              placeholder="依收據編號或姓名搜尋"
              allowClear
              style={{ width: 240 }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onSearch={handleSearch}
            />
            <Button icon={<FileExcelOutlined />} loading={exportingAll} onClick={handleExportAllExcel}>
              匯出 Excel
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          loading={receiptsQuery.isLoading}
          dataSource={receiptsQuery.data?.items ?? []}
          pagination={{
            current: page,
            pageSize,
            total: receiptsQuery.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: (newPage, newPageSize) => {
              setPage(newPage);
              if (newPageSize !== pageSize) setPageSize(newPageSize);
            },
            showTotal: (total) => `共 ${total} 筆`,
          }}
          columns={[
            { title: "收據編號", dataIndex: "receiptNo" },
            { title: "姓名", dataIndex: "payerName", render: (v: string) => v || "（未留姓名）" },
            { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
            { title: "經辦人", dataIndex: "issuedByName" },
            {
              title: "狀態",
              dataIndex: "status",
              render: (s: ReceiptStatus) =>
                s === ReceiptStatus.VOIDED ? <Tag color="red">已作廢</Tag> : <Tag color="green">正常</Tag>,
            },
            { title: "時間", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString("zh-TW") },
            {
              title: "操作",
              render: (_, record: ReceiptDetailDto) => (
                <Space>
                  <Button size="small" icon={<PrinterOutlined />} onClick={() => handleReprint(record)}>
                    補印
                  </Button>
                  <Button
                    size="small"
                    icon={<FilePdfOutlined />}
                    onClick={() => handleExportOneReceiptPdf(record)}
                  >
                    匯出 PDF
                  </Button>
                  {canVoid && record.status === ReceiptStatus.ISSUED && (
                    <Button danger size="small" onClick={() => setVoidTarget(record.id)}>
                      作廢
                    </Button>
                  )}
                  {canDelete && (
                    <Popconfirm
                      title="確定要永久刪除這張收據嗎？"
                      description="此操作無法復原，且會影響財務報表的歷史金額加總，僅建議用於清除明顯建錯/重複的收據。"
                      okText="永久刪除"
                      okButtonProps={{ danger: true, loading: deleteMutation.isPending }}
                      cancelText="取消"
                      onConfirm={() => deleteMutation.mutate(record.id)}
                    >
                      <Button danger size="small">
                        刪除
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="作廢收據"
        open={!!voidTarget}
        onCancel={() => setVoidTarget(null)}
        onOk={() => voidTarget && voidMutation.mutate({ id: voidTarget, reason: voidReason })}
        confirmLoading={voidMutation.isPending}
        okButtonProps={{ danger: true, disabled: voidReason.trim().length < 2 }}
      >
        <Typography.Paragraph>
          作廢後將寫入稽核紀錄；若此收據包含點燈或法會報名，對應的燈位/座位會一併釋放，可供其他人重新選用。請輸入作廢原因：
        </Typography.Paragraph>
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
      </Modal>
    </>
  );
}

function CeremonySeatModal({
  open,
  onClose,
  ceremonyId,
  ceremonyName,
  tableCount,
  seatsPerTable,
  maxSelections,
  wholeTableMode,
  onSelect,
  onConfirmMultiple,
  onSelectTable,
}: {
  open: boolean;
  onClose: () => void;
  ceremonyId: string;
  ceremonyName: string;
  tableCount: number;
  seatsPerTable: number;
  /** 提供此欄位時進入多選模式（整戶報名：一次選好幾個座位），需選滿此數量才能確認 */
  maxSelections?: number;
  /** 認領整桌模式：點選整桌即完成選擇，不需再逐一選位；只有整桌座位都空的桌次才能點選 */
  wholeTableMode?: boolean;
  onSelect?: (seat: CeremonySeatDto) => void;
  onConfirmMultiple?: (seats: CeremonySeatDto[]) => void;
  onSelectTable?: (tableNumber: number) => void;
}) {
  const isMulti = maxSelections != null;
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [chosenSeats, setChosenSeats] = useState<CeremonySeatDto[]>([]);

  const seatsQuery = useQuery({
    queryKey: ["ceremony-seats", ceremonyId],
    queryFn: () => getCeremonySeats(ceremonyId),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setSelectedTable(null);
      setChosenSeats([]);
    }
  }, [open]);

  const seats = seatsQuery.data ?? [];
  const tables = Array.from({ length: tableCount }, (_, i) => i + 1).map((tableNumber) => ({
    tableNumber,
    takenCount: seats.filter((s) => s.tableNumber === tableNumber && s.status === "TAKEN").length,
  }));
  const currentTableSeats = selectedTable ? seats.filter((s) => s.tableNumber === selectedTable) : [];

  const isChosen = (seat: CeremonySeatDto) => chosenSeats.some((s) => s.seatIndex === seat.seatIndex);

  const handleSeatClick = (seat: CeremonySeatDto) => {
    if (seat.status !== "EMPTY") return;
    if (!isMulti) {
      onSelect?.(seat);
      return;
    }
    setChosenSeats((prev) => {
      if (prev.some((s) => s.seatIndex === seat.seatIndex)) {
        return prev.filter((s) => s.seatIndex !== seat.seatIndex);
      }
      if (prev.length >= (maxSelections ?? 0)) return prev;
      return [...prev, seat];
    });
  };

  const center = 140;
  const radius = 110;

  return (
    <Modal
      title={
        wholeTableMode
          ? `認領整桌：${ceremonyName}`
          : isMulti
            ? `整戶選位：${ceremonyName}（已選 ${chosenSeats.length} / ${maxSelections} 位）`
            : `活動選位：${ceremonyName}`
      }
      open={open}
      onCancel={onClose}
      footer={
        isMulti ? (
          <Button
            type="primary"
            disabled={chosenSeats.length !== maxSelections}
            onClick={() => onConfirmMultiple?.(chosenSeats)}
          >
            確認選位（{chosenSeats.length} / {maxSelections}）
          </Button>
        ) : null
      }
      width={selectedTable != null ? 420 : 800}
    >
      {seatsQuery.isLoading ? (
        <Typography.Text>載入中...</Typography.Text>
      ) : selectedTable == null ? (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Typography.Text type="secondary">
            {wholeTableMode
              ? "請選擇要整桌認領的桌次（灰色表示已有座位被選走，整桌都空才能選）"
              : `請選擇桌次（灰色表示已滿）${isMulti ? "，整戶座位可以分散在不同桌" : ""}`}
          </Typography.Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
            {tables.map(({ tableNumber, takenCount }) => {
              const full = wholeTableMode ? takenCount > 0 : takenCount >= seatsPerTable;
              const chosenInTable = chosenSeats.filter((s) => s.tableNumber === tableNumber).length;
              return (
                <div
                  key={tableNumber}
                  onClick={() => {
                    if (full) return;
                    if (wholeTableMode) {
                      onSelectTable?.(tableNumber);
                      return;
                    }
                    setSelectedTable(tableNumber);
                  }}
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: "50%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    background: full ? "#bfbfbf" : chosenInTable > 0 ? "#1890ff" : "#c0504d",
                    color: "#fff",
                    cursor: full ? "not-allowed" : "pointer",
                    fontWeight: "bold",
                    textAlign: "center",
                  }}
                >
                  <div>第 {tableNumber} 桌</div>
                  <div style={{ fontSize: 12, fontWeight: "normal" }}>
                    {takenCount}/{seatsPerTable}
                    {chosenInTable > 0 ? `（已選${chosenInTable}）` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} align="center" size="middle">
          <Button onClick={() => setSelectedTable(null)}>← 返回選桌</Button>
          <div style={{ position: "relative", width: center * 2, height: center * 2 }}>
            <div
              style={{
                position: "absolute",
                left: center - 60,
                top: center - 60,
                width: 120,
                height: 120,
                borderRadius: "50%",
                background: "#c0504d",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                fontWeight: "bold",
              }}
            >
              第 {selectedTable} 桌
            </div>
            {currentTableSeats.map((seat, i) => {
              const angle = (2 * Math.PI * i) / currentTableSeats.length - Math.PI / 2;
              const x = center + radius * Math.cos(angle) - 28;
              const y = center + radius * Math.sin(angle) - 28;
              const empty = seat.status === "EMPTY";
              const chosen = isMulti && isChosen(seat);
              return (
                <div
                  key={seat.seatIndex}
                  onClick={() => handleSeatClick(seat)}
                  title={seat.participantName || (empty ? "空位" : "已入座")}
                  style={{
                    position: "absolute",
                    left: x,
                    top: y,
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: chosen ? "#1890ff" : empty ? "#4caf50" : "#e57373",
                    color: "#fff",
                    cursor: empty ? "pointer" : "not-allowed",
                    fontSize: 12,
                    textAlign: "center",
                    padding: 2,
                  }}
                >
                  {seat.seatInTable} 號
                </div>
              );
            })}
          </div>
          <Typography.Text type="secondary">
            綠色 = 空位，紅色 = 已入座{isMulti ? "，藍色 = 已選　點擊空位切換選取" : "，點擊空位即選定"}
          </Typography.Text>
        </Space>
      )}
    </Modal>
  );
}

/** 一筆活動報名請求裡涵蓋的人：已建檔信徒的 id 與臨櫃姓名（整戶報名另外帶入戶內成員 id） */
function peopleInRequest(request: RegisterCeremonyRequest, householdMemberIds: string[] = []) {
  const memberIds = [
    request.memberId,
    ...(request.passengerMemberIds ?? []).filter(Boolean),
    ...householdMemberIds,
  ].filter((id): id is string => !!id);
  const names = [
    request.walkInName?.trim(),
    ...(request.passengerNames ?? []).map((n) => n.trim()).filter(Boolean),
  ].filter((n): n is string => !!n);
  return { memberIds, names };
}

function CeremonyRegistrationFields({
  ceremonies,
  pendingItems,
  onAddPending,
  onRemovePending,
  shared,
  multi,
}: {
  shared: SharedPayer | null;
  /** 勾選「多人報名」：進香可以登錄多位參加者 */
  multi: boolean;
  ceremonies: CeremonyDto[];
  pendingItems: PendingCeremonyItem[];
  onAddPending: (item: PendingCeremonyItem) => void;
  onRemovePending: (index: number) => void;
}) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const payerMode = Form.useWatch("payerMode", form) ?? "member";
  const ceremonyId = Form.useWatch("ceremonyId", form);
  const memberId = Form.useWatch("memberId", form);
  const walkInName = Form.useWatch("walkInName", form);
  const householdId = Form.useWatch("householdId", form);
  const seatIndex = Form.useWatch("seatIndex", form);
  const seatLabel = Form.useWatch("seatLabel", form);
  const householdSeatIndexes = Form.useWatch("householdSeatIndexes", form) as number[] | undefined;
  const householdSeatLabel = Form.useWatch("householdSeatLabel", form);
  const tableNumber = Form.useWatch("tableNumber", form);
  const tableLabel = Form.useWatch("tableLabel", form);
  const noSeatNeeded = Form.useWatch("noSeatNeeded", form);
  const session = Form.useWatch("session", form) as CeremonySession | undefined;
  const participants = Form.useWatch("participants", form) as PilgrimParticipant[] | undefined;
  const roomTypeName = Form.useWatch("roomType", form) as string | undefined;
  const busNumberValue = Form.useWatch("busNumber", form) as number | undefined;
  const selectedCeremony = ceremonies.find((c) => c.id === ceremonyId);
  const [seatModalOpen, setSeatModalOpen] = useState(false);
  const [selectedMemberName, setSelectedMemberName] = useState<string | undefined>();
  useSyncSharedPayer(form, shared, pendingItems.length);

  const householdMembersQuery = useQuery({
    queryKey: ["household-members", householdId],
    queryFn: () => getHouseholdMembers(householdId),
    enabled: payerMode === "household" && !!householdId,
  });
  const headcount = householdMembersQuery.data?.length ?? 0;

  // 整戶報名 + 固定金額：金額自動算成「單價 x 人數」，不能手動改
  useEffect(() => {
    if (payerMode === "household" && selectedCeremony?.feeMode === CeremonyFeeMode.FIXED_AMOUNT && headcount > 0) {
      form.setFieldValue("amount", (selectedCeremony.fixedAmount ?? 0) * headcount);
    }
  }, [payerMode, headcount, selectedCeremony, form]);

  // 認領整桌 + 固定金額：金額自動算成「單價 x 每桌人數」，不能手動改
  useEffect(() => {
    if (
      payerMode === "table" &&
      selectedCeremony?.feeMode === CeremonyFeeMode.FIXED_AMOUNT &&
      selectedCeremony?.seatsPerTable
    ) {
      form.setFieldValue("amount", (selectedCeremony.fixedAmount ?? 0) * selectedCeremony.seatsPerTable);
    }
  }, [payerMode, selectedCeremony, form]);

  // 換戶籍時已選座位失效，一併清空
  useEffect(() => {
    form.setFieldValue("householdSeatIndexes", undefined);
    form.setFieldValue("householdSeatLabel", undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const isJigai = selectedCeremony?.kind === CeremonyKind.JIGAI;
  const isPilgrimage = selectedCeremony?.kind === CeremonyKind.PILGRIMAGE;
  const roomTypes = isPilgrimage ? (selectedCeremony?.roomTypes ?? []) : [];
  const hasRooms = roomTypes.length > 0;
  const selectedRoom = roomTypes.find((r) => r.name === roomTypeName);
  const needsSeatPicker = !isJigai && selectedCeremony?.totalSeats != null;
  // 進香：登錄所有參加者（每位可以是已建檔信徒或臨櫃香客），不選遊覽車座位；有房型時人數不可超過每間人數
  const isMultiSeatMode = isPilgrimage && (payerMode === "member" || payerMode === "walkIn");
  const participantCount = isMultiSeatMode ? (participants?.length ?? 0) : 0;
  // 本次收據已加入、尚未送出的同活動進香報名：也要算進剩餘房間與遊覽車座位，避免同一張收據超訂
  const pendingPilgrimage = pendingItems.filter((item) => isPilgrimage && item.request.ceremonyId === ceremonyId);
  const pendingRoomsOf = (name: string) => pendingPilgrimage.filter((item) => item.request.roomType === name).length;
  const roomsLeftOf = (r: (typeof roomTypes)[number]) =>
    r.roomCount == null ? null : r.roomCount - r.roomsBooked - pendingRoomsOf(r.name);
  // 遊覽車車次：只有 1 台時自動是第 1 車，2 台以上由報名者選；每車固定 PILGRIMAGE_BUS_SEAT_COUNT 位
  const busCount = SHOW_PILGRIMAGE_BUS && isPilgrimage ? (selectedCeremony?.busCount ?? 0) : 0;
  const hasBuses = busCount > 0;
  const multiBus = busCount > 1;
  const effectiveBus = hasBuses ? (busCount === 1 ? 1 : busNumberValue) : undefined;
  const pendingBusOf = (item: PendingCeremonyItem) => item.request.busNumber ?? (busCount === 1 ? 1 : undefined);
  const busLeftOf = (n: number) =>
    PILGRIMAGE_BUS_SEAT_COUNT -
    (selectedCeremony?.busLoads?.[n - 1] ?? 0) -
    pendingPilgrimage
      .filter((item) => pendingBusOf(item) === n)
      .reduce((sum, item) => sum + Math.max(1, item.request.passengerMemberIds?.length ?? 0), 0);
  const busSeatsLeft = effectiveBus != null ? busLeftOf(effectiveBus) : null;
  const overRoomCapacity = !!selectedRoom && participantCount > selectedRoom.capacity;
  const overBusCapacity = busSeatsLeft != null && participantCount > busSeatsLeft;
  // 本次收據已加入、尚未送出的座位，在選位圖上顯示成已有人，避免重複選到
  const reservedSeatIndexes = pendingItems
    .filter((item) => item.request.ceremonyId === ceremonyId)
    .flatMap((item) => [
      ...(item.request.householdSeatIndexes ?? []),
      ...(item.request.seatIndex != null ? [item.request.seatIndex] : []),
    ]);
  const householdReadyForSeats = payerMode === "household" && !!householdId && headcount > 0;
  const showSeatPicker = needsSeatPicker && (payerMode !== "household" ? true : householdReadyForSeats);
  // 「不需要座位」只開放給個人（已建檔信徒／臨櫃）報名，整戶與認領整桌仍需要座位
  const canSkipSeat = needsSeatPicker && !isPilgrimage && (payerMode === "member" || payerMode === "walkIn");

  // 勾選「不需要座位」時清空已選的座位，避免殘留舊選擇造成混淆
  useEffect(() => {
    if (noSeatNeeded) {
      form.setFieldValue("seatIndex", undefined);
      form.setFieldValue("seatLabel", undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noSeatNeeded]);

  // 選定的活動沒有設定桌數時，「認領整桌」選項沒有意義，隱藏並把已選到該模式的表單重置回預設值
  useEffect(() => {
    if ((!needsSeatPicker || isPilgrimage) && payerMode === "table") {
      form.setFieldValue("payerMode", "member");
    }
    // 進香的參加者名單本身就能登錄臨櫃香客，不需要另外的「臨櫃香客」「整戶報名」報名者類型
    if (isPilgrimage && (payerMode === "walkIn" || payerMode === "household")) {
      form.setFieldValue("payerMode", "member");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSeatPicker, isPilgrimage, payerMode]);

  // 進香 + 固定金額：金額自動算成「單價 x 參加人數」
  useEffect(() => {
    if (isMultiSeatMode && !hasRooms && selectedCeremony?.feeMode === CeremonyFeeMode.FIXED_AMOUNT) {
      form.setFieldValue("amount", (selectedCeremony.fixedAmount ?? 0) * Math.max(participantCount, 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiSeatMode, participantCount, selectedCeremony]);

  // 進香房型：每人計價，金額自動算成「房型每人費用 × 參加人數」；參加人數不用剛好等於房型人數
  useEffect(() => {
    if (!isMultiSeatMode || !hasRooms) return;
    form.setFieldValue("amount", selectedRoom ? selectedRoom.fee * Math.max(participantCount, 1) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiSeatMode, hasRooms, selectedRoom, participantCount]);

  const readyToAdd =
    !!ceremonyId &&
    (payerMode === "household"
      ? !!householdId && headcount > 0
      : isMultiSeatMode
        ? participantCount > 0 &&
          (!hasRooms || !!selectedRoom) &&
          (!multiBus || !!effectiveBus) &&
          !overRoomCapacity &&
          !overBusCapacity
        : payerMode === "walkIn"
          ? !!walkInName
          : !!memberId) &&
    (isJigai ? !!session : true) &&
    (!needsSeatPicker
      ? true
      : payerMode === "household"
        ? (householdSeatIndexes?.length ?? 0) === headcount
        : payerMode === "table"
          ? !!tableNumber
          : canSkipSeat && noSeatNeeded
            ? true
            : !!seatIndex);

  /**
   * 「加入」不會呼叫任何 API、不會建立資料庫紀錄，只是把這次報名的內容暫存到本次收據的項目清單裡；
   * 真正的報名紀錄（含配位）要到最後「送出並開立收據」才會建立，避免忘記送出時留下佔位卻沒收據的孤兒資料。
   */
  // 進香、沒有勾選多人報名：參加者就是最上方的報名者（一人）
  useEffect(() => {
    if (!shared || !isPilgrimage) return;
    form.setFieldValue("participants", [
      {
        mode: shared.mode,
        memberId: shared.mode === "member" ? shared.memberId : undefined,
        memberName: shared.name,
        name: shared.mode === "walkIn" ? shared.walkInName : undefined,
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared?.mode, shared?.memberId, shared?.walkInName, shared?.name, isPilgrimage, pendingItems.length]);

  const handleAdd = async () => {
    if (shared && !shared.ready) {
      message.warning(SHARED_PAYER_WARNING);
      return;
    }
    const values = await form.validateFields();
    // 進香：參加者名單第 1 位是收據上的報名者，其餘是同行參加者
    const plist = (isMultiSeatMode ? (values.participants ?? []) : []) as PilgrimParticipant[];
    const isWalkIn = (pt?: PilgrimParticipant) => pt?.mode === "walkIn";
    if (isMultiSeatMode && hasRooms) {
      if (!selectedRoom) {
        message.error("請選擇房型");
        return;
      }
      if (plist.length > selectedRoom.capacity) {
        message.error(`${selectedRoom.name}每間最多 ${selectedRoom.capacity} 人，目前登錄 ${plist.length} 人`);
        return;
      }
    }
    if (isMultiSeatMode) {
      if (multiBus && !effectiveBus) {
        message.error("請選擇車次");
        return;
      }
      if (busSeatsLeft != null && plist.length > busSeatsLeft) {
        message.error(`第 ${effectiveBus} 車座位不足，只剩 ${Math.max(busSeatsLeft, 0)} 位`);
        return;
      }
      const memberIds = plist.filter((pt) => !isWalkIn(pt)).map((pt) => pt.memberId as string);
      if (new Set(memberIds).size !== memberIds.length) {
        message.error("同一位信徒不能重複登錄，請檢查參加者名單");
        return;
      }
    }
    const first = plist[0];
    const request: RegisterCeremonyRequest = {
      ceremonyId: values.ceremonyId,
      memberId: isMultiSeatMode
        ? isWalkIn(first)
          ? undefined
          : first?.memberId
        : values.payerMode === "member" || values.payerMode === "table"
          ? values.memberId
          : undefined,
      walkInName: isMultiSeatMode
        ? isWalkIn(first)
          ? first?.name?.trim()
          : undefined
        : values.payerMode === "walkIn"
          ? values.walkInName
          : undefined,
      walkInAddress: !isMultiSeatMode && values.payerMode === "walkIn" ? values.walkInAddress : undefined,
      householdId: values.payerMode === "household" ? values.householdId : undefined,
      householdSeatIndexes: values.payerMode === "household" ? values.householdSeatIndexes : undefined,
      amount: values.amount,
      wishText: values.wishText,
      seatIndex:
        values.payerMode === "household" || values.payerMode === "table" || isMultiSeatMode ? undefined : values.seatIndex,
      passengerMemberIds: isMultiSeatMode
        ? plist.map((pt, i) => (i === 0 || isWalkIn(pt) ? "" : (pt.memberId ?? "")))
        : undefined,
      passengerNames: isMultiSeatMode
        ? plist.map((pt, i) => (i === 0 || !isWalkIn(pt) ? "" : (pt.name ?? "").trim()))
        : undefined,
      tableNumber: values.payerMode === "table" ? values.tableNumber : undefined,
      noSeatNeeded:
        (values.payerMode === "member" || values.payerMode === "walkIn") && values.noSeatNeeded ? true : undefined,
      session: isJigai ? values.session : undefined,
      roomType: isMultiSeatMode && hasRooms ? roomTypeName : undefined,
      busNumber: isMultiSeatMode && hasBuses ? effectiveBus : undefined,
    };

    // 重複報名提醒：這些人已經報名過這個活動（或已在本次收據加入過），先問櫃台是不是真的要再報一次
    const householdIds = values.payerMode === "household" ? (householdMembersQuery.data ?? []).map((m) => m.id) : [];
    const people = peopleInRequest(request, householdIds);
    const duplicateLines: string[] = [];
    for (const item of pendingItems.filter((i) => i.request.ceremonyId === request.ceremonyId)) {
      const pending = peopleInRequest(item.request);
      if (
        pending.memberIds.some((id) => people.memberIds.includes(id)) ||
        pending.names.some((n) => people.names.includes(n))
      ) {
        duplicateLines.push(`本次收據已加入：${item.displayLabel}`);
      }
    }
    try {
      const { duplicates } = await checkDuplicateRegistrations(request.ceremonyId, people);
      duplicateLines.push(...duplicates.map((d) => `${d.name || "（未留姓名）"}　已報名（${d.detail}）`));
    } catch {
      // 檢查失敗（例如網路不穩）不擋報名，只是少了提醒
    }
    if (duplicateLines.length > 0) {
      const proceed = await new Promise<boolean>((resolve) =>
        modal.confirm({
          title: "這些人已經報名過這個活動",
          content: (
            <div>
              <ul style={{ paddingLeft: 20, margin: "8px 0" }}>
                {duplicateLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div>確定要再報名一次嗎？（同名同姓的不同人也會被列出，請核對）</div>
            </div>
          ),
          okText: "確定要再報名",
          cancelText: "取消",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }),
      );
      if (!proceed) return;
    }

    const ceremonyName = selectedCeremony?.name ?? "";
    let displayLabel: string;
    if (values.payerMode === "table") {
      displayLabel = `${ceremonyName}（${shared?.name ?? selectedMemberName ?? ""} 認領整桌${tableLabel ? `　${tableLabel}` : ""}）`;
    } else if (values.payerMode === "household") {
      const names = householdMembersQuery.data?.map((m) => m.name).join("、") ?? "";
      displayLabel = `${ceremonyName}（整戶 ${names}${householdSeatLabel ? `　${householdSeatLabel}` : ""}）`;
    } else if (isMultiSeatMode) {
      const namesText = plist.map((pt) => pilgrimParticipantName(pt)).join("、");
      displayLabel = `${ceremonyName}（${effectiveBus ? `第${effectiveBus}車　` : ""}${selectedRoom ? `${selectedRoom.name}　` : ""}${namesText}）`;
    } else {
      const payerName = values.payerMode === "member" ? (shared?.name ?? selectedMemberName ?? "") : values.walkInName;
      displayLabel = `${ceremonyName}（${payerName}${
        isJigai ? `　${session === CeremonySession.AM ? "上午場" : "下午場"}` : request.noSeatNeeded ? "，不需要座位" : seatLabel ? `　${seatLabel}` : ""
      }）`;
    }
    onAddPending({ displayLabel, amount: values.amount, request });

    if (values.payerMode === "table" && tableLabel) {
      modal.success({
        title: "已加入本次活動報名項目",
        content: (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: 12, color: "#888" }}>認領整桌</div>
            <div style={{ fontSize: 40, fontWeight: "bold", color: "#a8071a" }}>{tableLabel}</div>
          </div>
        ),
      });
    } else if (values.payerMode !== "household" && !request.noSeatNeeded && seatLabel) {
      modal.success({
        title: "已加入本次活動報名項目",
        content: (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: 12, color: "#888" }}>座位號碼</div>
            <div style={{ fontSize: 40, fontWeight: "bold", color: "#a8071a" }}>{seatLabel}</div>
          </div>
        ),
      });
    } else if (values.payerMode === "household") {
      message.success(`已為整戶 ${headcount} 人加入本次活動報名項目`);
    } else if (request.noSeatNeeded) {
      message.success("已加入本次活動報名項目（不佔用座位）");
    } else {
      message.success("已加入本次活動報名項目");
    }

    form.setFieldsValue({
      ceremonyId: undefined,
      memberId: undefined,
      walkInName: undefined,
      walkInAddress: undefined,
      householdId: undefined,
      wishText: undefined,
      amount: undefined,
      seatIndex: undefined,
      seatLabel: undefined,
      householdSeatIndexes: undefined,
      householdSeatLabel: undefined,
      tableNumber: undefined,
      tableLabel: undefined,
      noSeatNeeded: false,
      session: undefined,
      participants: [{ mode: "member" }],
      roomType: undefined,
      busNumber: undefined,
    });
    setSelectedMemberName(undefined);
  };

  const handleRemove = (index: number) => {
    onRemovePending(index);
    message.success("已從本次收據項目中移除");
  };

  return (
    <Card title="活動與祭祀報名">
      <Form form={form} name="ceremonyRegistration" layout="vertical">
        <Form.Item label="選擇活動" name="ceremonyId" rules={[{ required: true }]}>
          <Select
            placeholder="請選擇活動"
            // 選單只顯示活動名稱（日期、收費方式、名額都不顯示）
            options={ceremonies.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(value) => {
              const ceremony = ceremonies.find((c) => c.id === value);
              if (ceremony?.feeMode === CeremonyFeeMode.FIXED_AMOUNT && payerMode !== "household") {
                form.setFieldValue(
                  "amount",
                  payerMode === "table" ? (ceremony.fixedAmount ?? 0) * (ceremony.seatsPerTable ?? 1) : ceremony.fixedAmount,
                );
              }
              form.setFieldValue("seatIndex", undefined);
              form.setFieldValue("seatLabel", undefined);
              form.setFieldValue("tableNumber", undefined);
              form.setFieldValue("tableLabel", undefined);
              form.setFieldValue("session", undefined);
              form.setFieldValue("roomType", undefined);
              form.setFieldValue("busNumber", undefined);
              form.setFieldValue("householdSeatIndexes", undefined);
              form.setFieldValue("householdSeatLabel", undefined);
            }}
          />
        </Form.Item>
        {isPilgrimage && hasRooms && (
          <Form.Item label="房型" name="roomType" rules={[{ required: true, message: "請選擇房型" }]}>
            <Select
              placeholder="請選擇房型"
              options={roomTypes.map((r) => {
                const left = roomsLeftOf(r);
                return {
                  value: r.name,
                  label: multi
                    ? `${r.name}（每間最多 ${r.capacity} 人，每人 NT$ ${r.fee}${left != null ? `，剩 ${Math.max(left, 0)} 間` : ""}）`
                    : `${r.name}（NT$ ${r.fee}${left != null ? `，剩 ${Math.max(left, 0)} 間` : ""}）`,
                  disabled: left != null && left <= 0,
                };
              })}
            />
          </Form.Item>
        )}
        {multiBus && (
          <Form.Item label="車次" name="busNumber" rules={[{ required: true, message: "請選擇車次" }]}>
            <Select
              placeholder="請選擇車次"
              options={Array.from({ length: busCount }, (_, i) => {
                const left = busLeftOf(i + 1);
                return {
                  value: i + 1,
                  label: `第 ${i + 1} 車（剩 ${Math.max(left, 0)} 位）`,
                  disabled: left <= 0,
                };
              })}
            />
          </Form.Item>
        )}
        {hasBuses && (
          <Alert
            type={Array.from({ length: busCount }, (_, i) => busLeftOf(i + 1)).some((left) => left > 0) ? "info" : "error"}
            showIcon
            style={{ marginBottom: 16 }}
            message={`遊覽車共 ${busCount} 台（每台 ${PILGRIMAGE_BUS_SEAT_COUNT} 位）：${Array.from(
              { length: busCount },
              (_, i) => `第 ${i + 1} 車剩 ${Math.max(busLeftOf(i + 1), 0)} 位`,
            ).join("、")}`}
          />
        )}
        {isJigai && selectedCeremony && (
          <Form.Item label="場次" name="session" rules={[{ required: true, message: "請選擇場次" }]}>
            <Radio.Group>
              <Radio.Button
                value={CeremonySession.AM}
                disabled={selectedCeremony.morningRegistered >= (selectedCeremony.morningCapacity ?? 0)}
              >
                上午場（{selectedCeremony.morningRegistered}/{selectedCeremony.morningCapacity}）
              </Radio.Button>
              <Radio.Button
                value={CeremonySession.PM}
                disabled={selectedCeremony.afternoonRegistered >= (selectedCeremony.afternoonCapacity ?? 0)}
              >
                下午場（{selectedCeremony.afternoonRegistered}/{selectedCeremony.afternoonCapacity}）
              </Radio.Button>
            </Radio.Group>
          </Form.Item>
        )}
        <div style={shared || isPilgrimage ? HIDDEN_STYLE : undefined}>
        <Form.Item label="報名者類型" name="payerMode" initialValue="member">
          <Radio.Group>
            <Radio.Button value="member">{isPilgrimage ? "登錄參加者（可多人）" : "已建檔信徒"}</Radio.Button>
            {!isPilgrimage && <Radio.Button value="walkIn">臨櫃香客（免建檔）</Radio.Button>}
            {!isPilgrimage && <Radio.Button value="household">整戶報名</Radio.Button>}
            {needsSeatPicker && !isPilgrimage && <Radio.Button value="table">認領整桌</Radio.Button>}
          </Radio.Group>
        </Form.Item>
        </div>
<div style={shared ? HIDDEN_STYLE : undefined}>
                {isMultiSeatMode ? (
          <Form.List name="participants" initialValue={[{ mode: "member" }]}>
            {(fields, { add, remove }) => (
              <Form.Item label={`參加者（共 ${fields.length} 位，第 1 位是收據上的報名者）`} required>
                <Space direction="vertical" style={{ width: "100%" }}>
                  {fields.map((field, index) => {
                    const mode = participants?.[field.name]?.mode ?? "member";
                    return (
                      <Card
                        key={field.key}
                        size="small"
                        title={`參加者 ${index + 1}${index === 0 ? "（報名者）" : ""}`}
                        extra={
                          fields.length > 1 && (
                            <Button size="small" danger onClick={() => remove(field.name)}>
                              移除
                            </Button>
                          )
                        }
                      >
                        <Form.Item name={[field.name, "mode"]} initialValue="member" style={{ marginBottom: 8 }}>
                          <Radio.Group
                            size="small"
                            optionType="button"
                            options={[
                              { label: "已建檔信徒", value: "member" },
                              { label: "臨櫃香客", value: "walkIn" },
                            ]}
                          />
                        </Form.Item>
                        {mode === "walkIn" ? (
                          <Form.Item
                            name={[field.name, "name"]}
                            rules={[{ required: true, whitespace: true, message: "請輸入姓名" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="姓名" />
                          </Form.Item>
                        ) : (
                          <Form.Item
                            name={[field.name, "memberId"]}
                            rules={[{ required: true, message: "請選擇信徒" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <MemberSelect
                              style={{ width: "100%" }}
                              onSelectMember={(m) =>
                                form.setFieldValue(["participants", field.name, "memberName"], m?.name)
                              }
                            />
                          </Form.Item>
                        )}
                        <Form.Item name={[field.name, "memberName"]} hidden>
                          <Input />
                        </Form.Item>
                      </Card>
                    );
                  })}
                  {multi && selectedRoom && (
                    <Typography.Text type={overRoomCapacity ? "danger" : "secondary"}>
                      {selectedRoom.name}每間最多 {selectedRoom.capacity} 人，目前 {fields.length} 人
                      {overRoomCapacity ? "，請移除多出的參加者或改選較大的房型" : ""}
                    </Typography.Text>
                  )}
                  {overBusCapacity && (
                    <Typography.Text type="danger">
                      第 {effectiveBus} 車座位不足，只剩 {Math.max(busSeatsLeft ?? 0, 0)} 位，請改選其他車次
                    </Typography.Text>
                  )}
                  {multi && (!selectedRoom || fields.length < selectedRoom.capacity) && (
                    <Button type="dashed" block onClick={() => add({ mode: "member" })}>
                      ＋ 新增參加者
                    </Button>
                  )}
                </Space>
              </Form.Item>
            )}
          </Form.List>
        ) : payerMode === "member" || payerMode === "table" ? (
          <Form.Item label="信徒" name="memberId" rules={[{ required: true, message: "請選擇信徒" }]}>
            <MemberSelect onSelectMember={(m) => setSelectedMemberName(m?.name)} />
          </Form.Item>
        ) : payerMode === "household" ? (
          <>
            <Form.Item label="搜尋戶籍（地址或戶內成員姓名）" name="householdId" rules={[{ required: true, message: "請選擇戶籍" }]}>
              <HouseholdSelect />
            </Form.Item>
            {householdId && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={
                  householdMembersQuery.isLoading
                    ? "查詢戶內成員中..."
                    : headcount === 0
                      ? "此戶籍尚無信徒資料"
                      : `共 ${headcount} 人：${householdMembersQuery.data?.map((m) => m.name).join("、")}`
                }
              />
            )}
          </>
        ) : (
          <>
            <Form.Item label="姓名" name="walkInName" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item label="地址（選填）" name="walkInAddress">
              <Input />
            </Form.Item>
          </>
        )}
        </div>
                <Form.Item label="祈願內容" name="wishText">
          <Input.TextArea rows={2} placeholder="活動宣讀用，例如：闔家平安、消災解厄" />
        </Form.Item>
        <Form.Item
          label="金額"
          name="amount"
          rules={[{ required: true }]}
          extra={
            hasRooms
              ? selectedRoom
                ? `${selectedRoom.name}每人 NT$ ${selectedRoom.fee} × ${Math.max(participantCount, 1)} 人`
                : "請先選擇房型"
              : selectedCeremony?.feeMode === CeremonyFeeMode.FIXED_AMOUNT
              ? payerMode === "household"
                ? `此活動為固定金額，已自動算成單價 x ${headcount || "?"} 人`
                : payerMode === "table"
                  ? `此活動為固定金額，已自動算成單價 x 每桌 ${selectedCeremony.seatsPerTable ?? "?"} 人`
                  : isMultiSeatMode && !hasRooms
                    ? `此活動為固定金額，已自動算成單價 x ${participantCount || 1} 人`
                    : "此活動為固定金額"
              : payerMode === "household"
                ? "隨喜金額，請直接輸入整戶合計金額"
                : payerMode === "table"
                  ? "隨喜金額，請直接輸入整桌合計金額"
                  : isMultiSeatMode && participantCount > 1
                    ? "隨喜金額，請直接輸入全部參加者的合計金額"
                    : "隨喜金額，可自行輸入"
          }
        >
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            disabled={selectedCeremony?.feeMode === CeremonyFeeMode.FIXED_AMOUNT || hasRooms}
          />
        </Form.Item>
        <Form.Item name="seatIndex" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="seatLabel" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="householdSeatIndexes" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="householdSeatLabel" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="tableNumber" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="tableLabel" hidden>
          <Input />
        </Form.Item>
        {needsSeatPicker && payerMode === "household" && !householdReadyForSeats && (
          <Form.Item label="座位">
            <Typography.Text type="secondary">請先選擇戶籍才能選位</Typography.Text>
          </Form.Item>
        )}
        {canSkipSeat && (
          <Form.Item name="noSeatNeeded" valuePropName="checked" initialValue={false}>
            <Checkbox>不需要座位（此人不佔用座位，例如純捐款／隨喜）</Checkbox>
          </Form.Item>
        )}
        {showSeatPicker && !(canSkipSeat && noSeatNeeded) && (
          <Form.Item label={payerMode === "table" ? "桌次" : "座位"} required>
            <Space align="center" wrap>
              <Button onClick={() => setSeatModalOpen(true)}>
                {payerMode === "table"
                  ? tableNumber
                    ? "重新選擇桌次"
                    : "選擇桌次"
                  : payerMode === "household"
                    ? householdSeatIndexes?.length
                      ? "重新選擇座位"
                      : `選擇座位（需選 ${headcount} 位）`
                    : seatIndex
                      ? "重新選擇座位"
                      : "選擇座位"}
              </Button>
              {payerMode === "table"
                ? tableLabel && <Tag color="green">已選 {tableLabel}</Tag>
                : payerMode === "household"
                  ? householdSeatLabel && <Tag color="green">已選位 {householdSeatLabel}</Tag>
                  : seatLabel && <Tag color="green">已選位 {seatLabel}</Tag>}
            </Space>
          </Form.Item>
        )}
      </Form>

      {showSeatPicker && !isPilgrimage && (
        <CeremonySeatModal
          open={seatModalOpen}
          onClose={() => setSeatModalOpen(false)}
          ceremonyId={selectedCeremony!.id}
          ceremonyName={selectedCeremony!.name}
          tableCount={selectedCeremony!.tableCount!}
          seatsPerTable={selectedCeremony!.seatsPerTable!}
          maxSelections={payerMode === "household" ? headcount : undefined}
          wholeTableMode={payerMode === "table"}
          onSelect={
            payerMode === "household" || payerMode === "table"
              ? undefined
              : (seat) => {
                  form.setFieldValue("seatIndex", seat.seatIndex);
                  form.setFieldValue("seatLabel", `${seat.tableNumber}桌${seat.seatInTable}號`);
                  setSeatModalOpen(false);
                }
          }
          onConfirmMultiple={
            payerMode === "household"
              ? (seats) => {
                  form.setFieldValue(
                    "householdSeatIndexes",
                    seats.map((s) => s.seatIndex),
                  );
                  form.setFieldValue(
                    "householdSeatLabel",
                    seats.map((s) => `${s.tableNumber}桌${s.seatInTable}號`).join("、"),
                  );
                  setSeatModalOpen(false);
                }
              : undefined
          }
          onSelectTable={
            payerMode === "table"
              ? (chosenTableNumber) => {
                  form.setFieldValue("tableNumber", chosenTableNumber);
                  form.setFieldValue("tableLabel", `第${chosenTableNumber}桌`);
                  setSeatModalOpen(false);
                }
              : undefined
          }
        />
      )}

      <Button
        type="primary"
        danger
        block
        size="large"
        style={{ fontSize: 18, fontWeight: "bold", height: 48 }}
        disabled={!readyToAdd}
        onClick={handleAdd}
      >
        加入本次活動報名項目
      </Button>

      {pendingItems.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          message={
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {pendingItems.map((item, i) => (
                <Space key={i} align="center">
                  <span>
                    {item.displayLabel} NT$ {item.amount.toLocaleString()}，將併入本次收據
                  </span>
                  <Popconfirm
                    title="確定要移除這筆報名項目嗎？"
                    description="尚未送出，直接從本次收據項目移除即可"
                    okText="移除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => handleRemove(i)}
                  >
                    <Button size="small" danger>
                      移除
                    </Button>
                  </Popconfirm>
                </Space>
              ))}
            </Space>
          }
        />
      )}
    </Card>
  );
}

function LanternSlotPickerModal({
  open,
  onClose,
  wallId,
  wallName,
  maxSelections,
  freeMulti,
  initialChosen,
  onSelect,
  onConfirmMultiple,
}: {
  open: boolean;
  onClose: () => void;
  wallId?: string;
  wallName: string;
  /** 提供此欄位時進入多選模式（整戶點燈：一次選好幾盞燈），需選滿此數量才能確認 */
  maxSelections?: number;
  /** 不限數量的多選（單人一次點好幾盞燈）：至少選 1 個燈位就能確認 */
  freeMulti?: boolean;
  /** 已經選好的燈位：重新開啟選位視窗時帶回，不用重選 */
  initialChosen?: LanternSlotDto[];
  onSelect?: (slot: LanternSlotDto) => void;
  onConfirmMultiple?: (slots: LanternSlotDto[]) => void;
}) {
  const isMulti = maxSelections != null || !!freeMulti;
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<LanternSlotDto[]>([]);

  const slotsQuery = useQuery({
    queryKey: ["wall-slots", wallId],
    queryFn: () => getWallSlots(wallId!),
    enabled: open && !!wallId,
  });

  useEffect(() => {
    setChosen(open ? (initialChosen ?? []) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 即時同步：其他地點櫃台認領燈位時，立即更新本地畫面，避免多地點重複選同一顆燈位
  useEffect(() => {
    if (!open) return;
    const socket = io("/lantern");
    socket.on("slot.claimed", (event: SlotClaimedEvent) => {
      queryClient.setQueryData<LanternSlotDto[]>(["wall-slots", event.wallId], (old) =>
        old ? old.map((s) => (s.id === event.slot.id ? event.slot : s)) : old,
      );
    });
    return () => {
      socket.disconnect();
    };
  }, [open, queryClient]);

  const isChosen = (slot: LanternSlotDto) => chosen.some((s) => s.id === slot.id);

  const handleClick = (slot: LanternSlotDto) => {
    if (slot.status !== LanternSlotStatus.EMPTY) return;
    if (!isMulti) {
      onSelect?.(slot);
      return;
    }
    setChosen((prev) => {
      if (prev.some((s) => s.id === slot.id)) return prev.filter((s) => s.id !== slot.id);
      if (maxSelections != null && prev.length >= maxSelections) return prev;
      return [...prev, slot];
    });
  };

  // 讓 Modal 寬度剛好容納最長的一排燈位（一橫排），不用捲軸就能看到整排；
  // .slot-cell 固定寬 90px、.table-seat-row 間距 10px（見 index.css），超出視窗寬度時才退而求其次維持 95vw
  const slots = slotsQuery.data ?? [];
  const rowWidth = slots.length
    ? Math.max(
        ...Array.from(new Set(slots.map((s) => s.gridRow))).map((r) => {
          const rowSlots = slots.filter((s) => s.gridRow === r);
          return rowSlots.reduce((sum, s) => sum + lanternCellWidth(s), 0) + (rowSlots.length - 1) * 10;
        }),
      )
    : 0;
  const modalWidth =
    rowWidth > 0 ? Math.min(Math.max(rowWidth + 48, 700), Math.floor(window.innerWidth * 0.95)) : 700;

  return (
    <Modal
      title={
        isMulti
          ? `選擇燈位：${wallName}（已選 ${chosen.length}${maxSelections != null ? ` / ${maxSelections}` : " 個"}）`
          : `選擇燈位：${wallName}`
      }
      open={open}
      onCancel={onClose}
      footer={
        isMulti ? (
          <Button
            type="primary"
            disabled={maxSelections != null ? chosen.length !== maxSelections : chosen.length === 0}
            onClick={() => onConfirmMultiple?.(chosen)}
          >
            確認選位（{chosen.length}
            {maxSelections != null ? ` / ${maxSelections}` : " 個"}）
          </Button>
        ) : null
      }
      width={modalWidth}
    >
      {slotsQuery.isLoading ? (
        <Typography.Text>載入中...</Typography.Text>
      ) : (
        <>
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            {Array.from(new Set((slotsQuery.data ?? []).map((s) => s.gridRow)))
              .sort((a, b) => a - b)
              .map((gridRow) => (
                <div key={gridRow}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                    第{" "}
                    {Array.from(
                      new Set((slotsQuery.data ?? []).filter((s) => s.gridRow === gridRow).map((s) => s.row)),
                    ).join("、")}{" "}
                    排
                  </Typography.Text>
                  <div className="table-seat-row lantern-row">
                    {(slotsQuery.data ?? [])
                      .filter((s) => s.gridRow === gridRow)
                      .sort((a, b) => a.gridColumn - b.gridColumn)
                      .map((slot) => {
                        const empty = slot.status === LanternSlotStatus.EMPTY;
                        const chosenHere = isMulti && isChosen(slot);
                        return (
                          <div
                            key={slot.id}
                            className={`slot-cell ${empty ? "empty" : "claimed"}`}
                            style={chosenHere ? { background: "#1890ff" } : undefined}
                            title={slot.claim ? slot.claim.memberName : empty ? "空燈位" : "已認領"}
                            onClick={() => handleClick(slot)}
                          >
                            <div>{slot.code}</div>
                            {slot.claim && <div style={{ fontSize: 12 }}>{slot.claim.memberName}</div>}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
          </Space>
          {(slotsQuery.data ?? []).length === 0 && (
            <Typography.Text type="secondary">此燈牆尚無燈位，請至「建立活動」頁面設定數量與排列</Typography.Text>
          )}
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            綠色 = 空燈位，紅色 = 已認領{isMulti ? "，藍色 = 已選　點擊空燈位切換選取" : "，點擊空燈位即選定"}
          </Typography.Text>
        </>
      )}
    </Modal>
  );
}

/** 單人點燈時已選好的燈位：每個燈位各點一種燈 */
type PickedLantern = { slotId: string; code: string; lanternType?: string; slot: LanternSlotDto };

function LanternFields({
  templeId,
  pendingItems,
  onAddPending,
  onRemovePending,
  shared,
}: {
  shared: SharedPayer | null;
  templeId: string;
  pendingItems: PendingLanternItem[];
  onAddPending: (item: PendingLanternItem) => void;
  onRemovePending: (index: number) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const payerMode = Form.useWatch("payerMode", form) ?? "member";
  const wallId = Form.useWatch("wallId", form);
  const householdId = Form.useWatch("householdId", form);
  // 單人點燈已選的燈位與各自的燈種：純粹是畫面狀態，不放進表單欄位
  // （曾放在隱藏的 Input 欄位裡，結果選第二盞燈種時會把第一盞的值蓋掉）
  const [picked, setPicked] = useState<PickedLantern[]>([]);
  const wasTaisuiWall = useRef(false);
  const lanternType = Form.useWatch("lanternType", form) as string | undefined;
  const householdSlotIds = Form.useWatch("householdSlotIds", form) as string[] | undefined;
  const householdSlotLabel = Form.useWatch("householdSlotLabel", form);
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [selectedMemberName, setSelectedMemberName] = useState<string | undefined>();
  useSyncSharedPayer(form, shared, pendingItems.length);

  const wallsQuery = useQuery({ queryKey: ["walls", templeId], queryFn: () => listWalls(templeId) });
  const wall = wallsQuery.data?.find((w) => w.id === wallId);
  // 依燈種計價：燈種與價格由總幹事在「系統設定」維護
  const typesQuery = useQuery({ queryKey: ["lantern-types", templeId], queryFn: () => getLanternTypes(templeId) });
  const lanternTypes = typesQuery.data ?? [];
  const priceOf = (name?: string) => lanternTypes.find((t) => t.name === name)?.price;
  const typeOptions = (wall?.isTaisuiWall ? lanternTypes.filter((t) => t.name === TAISUI_LANTERN_TYPE) : lanternTypes).map((t) => ({
    value: t.name,
    label: `${t.name}　NT$ ${t.price.toLocaleString()}`,
  }));

  useEffect(() => {
    if (!wallId && wallsQuery.data && wallsQuery.data.length > 0) {
      form.setFieldValue("wallId", wallsQuery.data[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallsQuery.data]);

  const householdMembersQuery = useQuery({
    queryKey: ["household-members", householdId],
    queryFn: () => getHouseholdMembers(householdId),
    enabled: payerMode === "household" && !!householdId,
  });
  const headcount = householdMembersQuery.data?.length ?? 0;

  // 換燈牆時，已選的燈位失效；太歲燈牆的燈種固定是「太歲燈」
  useEffect(() => {
    setPicked([]);
    form.setFieldValue("householdSlotIds", undefined);
    form.setFieldValue("householdSlotLabel", undefined);
    if (wall?.isTaisuiWall) {
      form.setFieldValue("lanternType", TAISUI_LANTERN_TYPE);
    } else if (wasTaisuiWall.current) {
      // 從太歲燈牆換成一般燈牆：原本的「太歲燈」是系統強制帶入的，清掉讓櫃台重新選；
      // 一般燈牆之間切換則保留櫃台自己選好的燈種
      form.setFieldValue("lanternType", undefined);
    }
    wasTaisuiWall.current = !!wall?.isTaisuiWall;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallId, wall?.isTaisuiWall]);

  // 換戶籍或換報名者類型時，已選的整戶燈位失效，一併清空
  useEffect(() => {
    form.setFieldValue("householdSlotIds", undefined);
    form.setFieldValue("householdSlotLabel", undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, payerMode]);

  // 金額依燈種自動算出且鎖定：單人 = 各燈位燈種價格相加；整戶 = 燈種價格 × 戶內人數
  const totalAmount =
    payerMode === "household"
      ? (priceOf(lanternType) ?? 0) * headcount
      : picked.reduce((sum, p) => sum + (priceOf(p.lanternType) ?? 0), 0);
  useEffect(() => {
    form.setFieldValue("amount", totalAmount);
  }, [totalAmount, form]);

  // 先選燈種，再選燈牆和燈位
  const canPickSlot = !!lanternType && !!wallId && (payerMode === "household" ? headcount > 0 : true);
  const readyToAdd =
    payerMode === "household"
      ? (householdSlotIds?.length ?? 0) === headcount && headcount > 0 && !!lanternType
      : picked.length > 0 && picked.every((p) => !!p.lanternType);

  /**
   * 「加入」不會呼叫任何 API、不會建立資料庫紀錄，只是把這次點燈的內容暫存到本次收據的項目清單裡；
   * 真正的認領紀錄（含卡位）要到最後「送出並開立收據」才會建立，避免忘記送出時留下卡位卻沒收據的孤兒資料。
   * 單人一次選好幾個燈位時，每個燈位各自是一個項目（各點一種燈、各一筆金額）。
   */
  const handleAdd = async () => {
    if (shared && !shared.ready) {
      message.warning(SHARED_PAYER_WARNING);
      return;
    }
    const values = await form.validateFields();
    if (payerMode === "household") {
      const type = lanternType as string;
      const householdRequest: ClaimHouseholdLanternSlotsRequest = {
        wallId: values.wallId,
        householdId: values.householdId,
        slotIds: values.householdSlotIds,
        lanternType: type,
        amount: totalAmount,
      };
      const names = householdMembersQuery.data?.map((m) => m.name).join("、") ?? "";
      onAddPending({
        displayLabel: `${type}（整戶 ${names}${householdSlotLabel ? `　${householdSlotLabel}` : ""}）`,
        amount: totalAmount,
        household: householdRequest,
      });
      message.success(`已為整戶 ${headcount} 人加入本次點燈項目`);
      form.setFieldsValue({
        householdSlotIds: undefined,
        householdSlotLabel: undefined,
      });
    } else {
      const payerName = payerMode === "member" ? (shared?.name ?? selectedMemberName ?? "") : values.walkInName;
      for (const p of picked) {
        const price = priceOf(p.lanternType) ?? 0;
        const singleRequest: ClaimLanternSlotRequest = {
          slotId: p.slotId,
          memberId: payerMode === "member" ? values.memberId : undefined,
          walkInName: payerMode === "walkIn" ? values.walkInName : undefined,
          wishText: values.wishText,
          petitionText: values.petitionText,
          lanternType: p.lanternType,
          amount: price,
        };
        onAddPending({
          displayLabel: `${p.lanternType}（${payerName}　${p.code}）`,
          amount: price,
          single: singleRequest,
        });
      }
      message.success(picked.length > 1 ? `已加入 ${picked.length} 盞燈到本次點燈項目` : "已加入本次點燈項目");
      form.setFieldsValue({
        memberId: undefined,
        walkInName: undefined,
        wishText: undefined,
        petitionText: undefined,
      });
      setPicked([]);
      setSelectedMemberName(undefined);
    }
  };

  const handleRemove = (index: number) => {
    onRemovePending(index);
    message.success("已從本次收據項目中移除");
  };

  const setPickedType = (slotId: string, lanternType: string) =>
    setPicked((current) => current.map((p) => (p.slotId === slotId ? { ...p, lanternType } : p)));

  return (
    <Card title="點燈">
      <Form form={form} name="lantern" layout="vertical">
        <div style={shared ? HIDDEN_STYLE : undefined}>
        <Form.Item label="報名者類型" name="payerMode" initialValue="member">
          <Radio.Group>
            <Radio.Button value="member">已建檔信徒</Radio.Button>
            <Radio.Button value="walkIn">臨櫃香客（免建檔）</Radio.Button>
            <Radio.Button value="household">整戶點燈</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {payerMode === "member" ? (
          <Form.Item label="信徒" name="memberId" rules={[{ required: true, message: "請選擇信徒" }]}>
            <MemberSelect onSelectMember={(m) => setSelectedMemberName(m?.name)} />
          </Form.Item>
        ) : payerMode === "household" ? (
          <>
            <Form.Item
              label="搜尋戶籍（地址或戶內成員姓名）"
              name="householdId"
              rules={[{ required: true, message: "請選擇戶籍" }]}
            >
              <HouseholdSelect />
            </Form.Item>
            {householdId && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={
                  householdMembersQuery.isLoading
                    ? "查詢戶內成員中..."
                    : headcount === 0
                      ? "此戶籍尚無信徒資料"
                      : `共 ${headcount} 人：${householdMembersQuery.data?.map((m) => m.name).join("、")}`
                }
              />
            )}
          </>
        ) : (
          <Form.Item label="姓名" name="walkInName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        )}
        </div>
        <Form.Item
          label="燈種（先選燈種，再選燈牆和燈位）"
          name="lanternType"
          rules={[{ required: true, message: "請選擇燈種" }]}
          extra={
            wall?.isTaisuiWall
              ? "太歲燈牆固定點「太歲燈」，不開放更改"
              : payerMode === "household"
                ? "整戶點同一種燈，金額 = 燈種價格 × 戶內人數"
                : "選好後，選到的燈位都先用這個燈種；個別燈位可以再改成別種"
          }
        >
          <Select
            disabled={wall?.isTaisuiWall}
            loading={typesQuery.isLoading}
            options={typeOptions}
            placeholder="請選擇燈種"
            onChange={(value) => setPicked((current) => current.map((p) => ({ ...p, lanternType: value })))}
          />
        </Form.Item>
        <Form.Item label="燈牆" name="wallId" rules={[{ required: true, message: "請選擇燈牆" }]}>
          <Select
            placeholder="尚無燈牆，請先新增"
            options={(wallsQuery.data ?? []).map((w) => ({
              value: w.id,
              label: `${w.name}（${w.year}年）${w.isTaisuiWall ? "　太歲燈牆" : ""}`,
            }))}
          />
        </Form.Item>
        {payerMode !== "household" && (
          <>
            <Form.Item
              label="燈位（一次可選多個燈位，每個燈位各點一種燈）"
              required
              extra="選好燈位後，每個燈位預設是上面選的燈種，可以個別改；金額依燈種自動計算"
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                <Button disabled={!canPickSlot} onClick={() => setSlotModalOpen(true)}>
                  {picked.length > 0 ? `重新選擇燈位（已選 ${picked.length} 個）` : "選擇燈位"}
                </Button>
                {picked.map((p) => (
                  <Space key={p.slotId} align="center" wrap>
                    <Tag color="green" style={{ fontSize: 16, padding: "4px 10px" }}>
                      {p.code}
                    </Tag>
                    <Select
                      style={{ width: 240 }}
                      placeholder="請選擇燈種"
                      loading={typesQuery.isLoading}
                      value={p.lanternType}
                      options={typeOptions}
                      onChange={(value) => setPickedType(p.slotId, value)}
                    />
                    {p.lanternType && <Typography.Text type="secondary">NT$ {(priceOf(p.lanternType) ?? 0).toLocaleString()}</Typography.Text>}
                  </Space>
                ))}
              </Space>
            </Form.Item>
            <Form.Item label="祈願內容" name="wishText">
              <Input.TextArea rows={2} placeholder="例如：闔家平安、事業順利" />
            </Form.Item>
            <Form.Item label="疏文" name="petitionText">
              <Input.TextArea rows={4} placeholder="正式祈福文書內容（選填）" />
            </Form.Item>
          </>
        )}
        {payerMode === "household" && (
          <>
            <Form.Item label="燈位" required>
              <Space align="center" wrap>
                <Button disabled={!canPickSlot} onClick={() => setSlotModalOpen(true)}>
                  {householdSlotIds?.length ? "重新選擇燈位" : `選擇燈位（需選 ${headcount || "?"} 盞）`}
                </Button>
                {householdSlotLabel && <Tag color="green">已選 {householdSlotLabel}</Tag>}
              </Space>
            </Form.Item>
          </>
        )}
        <Form.Item
          label="金額（依燈種自動計算，不能修改）"
          name="amount"
          extra={
            payerMode === "household"
              ? `${lanternType ?? "燈種"}每盞 NT$ ${(priceOf(lanternType) ?? 0).toLocaleString()} × ${headcount || "?"} 人`
              : picked.length > 0
                ? picked.map((p) => `${p.code} ${p.lanternType ?? "（未選燈種）"} ${priceOf(p.lanternType) ?? 0}`).join("＋")
                : undefined
          }
        >
          <InputNumber style={{ width: "100%" }} min={0} disabled />
        </Form.Item>
        <Form.Item name="householdSlotIds" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="householdSlotLabel" hidden>
          <Input />
        </Form.Item>
        <Button
          type="primary"
          danger
          block
          size="large"
          style={{ fontSize: 18, fontWeight: "bold", height: 48 }}
          disabled={!readyToAdd}
          onClick={handleAdd}
        >
          加入本次點燈項目
        </Button>
      </Form>

      {wallId && (
        <LanternSlotPickerModal
          open={slotModalOpen}
          onClose={() => setSlotModalOpen(false)}
          wallId={wallId}
          wallName={wall?.name ?? ""}
          maxSelections={payerMode === "household" ? headcount : undefined}
          freeMulti={payerMode !== "household"}
          onConfirmMultiple={(slots) => {
            if (payerMode === "household") {
              form.setFieldValue(
                "householdSlotIds",
                slots.map((s) => s.id),
              );
              form.setFieldValue("householdSlotLabel", slots.map((s) => s.code).join("、"));
            } else {
              // 保留已經選過燈種的燈位；太歲燈牆的燈種自動帶入「太歲燈」
              const keep = new Map(picked.map((p) => [p.slotId, p.lanternType]));
              setPicked(
                slots.map((s) => ({
                  slot: s,
                  slotId: s.id,
                  code: s.code,
                  lanternType: keep.get(s.id) ?? lanternType,
                })),
              );
            }
            setSlotModalOpen(false);
          }}
          initialChosen={payerMode === "household" ? undefined : picked.map((p) => p.slot)}
        />
      )}

      {pendingItems.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          message={
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {pendingItems.map((item, i) => (
                <Space key={i} align="center">
                  <span>
                    {item.displayLabel} NT$ {item.amount.toLocaleString()}，將併入本次收據
                  </span>
                  <Popconfirm
                    title="確定要移除這筆點燈項目嗎？"
                    description="尚未送出，直接從本次收據項目移除即可"
                    okText="移除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => handleRemove(i)}
                  >
                    <Button size="small" danger>
                      移除
                    </Button>
                  </Popconfirm>
                </Space>
              ))}
            </Space>
          }
        />
      )}
    </Card>
  );
}

export function ActivityRegistrationPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { activeTempleId } = useTemple();
  const templeId = activeTempleId === ALL_TEMPLES ? undefined : activeTempleId;
  const [selected, setSelected] = useState<ActivityKey[]>([]);
  const [pendingLanternItems, setPendingLanternItems] = useState<PendingLanternItem[]>([]);
  const [pendingCeremonyItems, setPendingCeremonyItems] = useState<PendingCeremonyItem[]>([]);
  const [pendingDonationItems, setPendingDonationItems] = useState<PendingDonationItem[]>([]);
  const [pendingGiftItems, setPendingGiftItems] = useState<PendingGiftItem[]>([]);
  const [donationForm] = Form.useForm();
  const [giftForm] = Form.useForm();
  // 「多人報名」：沒勾選時整張收據只填一次報名者，各區塊沿用；勾選才分別填寫
  const [multi, setMulti] = useState(false);
  const [payerMode, setPayerMode] = useState<"member" | "walkIn">("member");
  const [payerMemberId, setPayerMemberId] = useState<string | undefined>();
  const [payerMemberName, setPayerMemberName] = useState<string | undefined>();
  const [payerWalkInName, setPayerWalkInName] = useState("");
  const shared: SharedPayer | null = multi
    ? null
    : {
        mode: payerMode,
        memberId: payerMemberId,
        walkInName: payerWalkInName.trim() || undefined,
        name: payerMode === "member" ? (payerMemberName ?? "") : payerWalkInName.trim(),
        ready: payerMode === "member" ? !!payerMemberId : !!payerWalkInName.trim(),
      };

  const ceremoniesQuery = useQuery({
    queryKey: ["ceremonies", templeId, "active"],
    queryFn: () => listCeremonies(templeId, true),
    enabled: !!templeId,
  });

  const previewTotal =
    pendingLanternItems.reduce((sum, item) => sum + item.amount, 0) +
    pendingCeremonyItems.reduce((sum, item) => sum + item.amount, 0) +
    pendingDonationItems.reduce((sum, item) => sum + item.amount, 0);

  const submitMutation = useMutation({
    mutationFn: submitActivities,
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      await openPrintWindow(`/print/receipt/${result.receipt.id}`);

      message.success("已開立收據");
      setPayerMemberId(undefined);
      setPayerMemberName(undefined);
      setPayerWalkInName("");
      donationForm.resetFields();
      giftForm.resetFields();
      setPendingLanternItems([]);
      setPendingCeremonyItems([]);
      setPendingDonationItems([]);
      setPendingGiftItems([]);
      setSelected([]);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "送出失敗，請重試");
    },
  });

  const handleActivityChange = (checked: ActivityKey[]) => {
    setSelected(checked);
  };

  const handleSubmit = async () => {
    const allPendingItems = [
      ...pendingLanternItems,
      ...pendingCeremonyItems,
      ...pendingDonationItems,
      ...pendingGiftItems,
    ];

    if (selected.length === 0 && allPendingItems.length === 0) {
      message.warning("請先勾選要辦理的項目");
      return;
    }
    if (selected.includes("lantern") && pendingLanternItems.length === 0) {
      message.warning("請先完成點燈選位");
      return;
    }
    if (selected.includes("ceremony") && pendingCeremonyItems.length === 0) {
      message.warning("請先完成活動報名（點擊「加入本次活動報名項目」）");
      return;
    }

    // 捐款與送禮可以加入多筆；沒有加入任何一筆，或表單上還有填了沒加入的內容，都要先處理
    for (const [key, label, form, items] of [
      ["donation", "捐款", donationForm, pendingDonationItems],
      ["gift", "送禮", giftForm, pendingGiftItems],
    ] as const) {
      if (!selected.includes(key)) continue;
      if (items.length === 0) {
        message.warning(`請先完成${label}（點擊「加入本次${label}項目」）`);
        return;
      }
      if (form.isFieldsTouched(["memberId", "walkInName", "amount", "giftTypes"])) {
        message.warning(`${label}表單上還有填寫但沒有加入的內容，請點擊「加入本次${label}項目」，或清空後再送出`);
        return;
      }
    }

    if (!templeId) {
      message.warning("請先在上方選擇一間廟宇");
      return;
    }

    const payload: SubmitActivitiesRequest = {
      donations: pendingDonationItems.length ? pendingDonationItems.map((item) => item.request) : undefined,
      gifts: pendingGiftItems.length ? pendingGiftItems.map((item) => item.request) : undefined,
      pendingLanternClaims: pendingLanternItems.length
        ? pendingLanternItems.filter((item) => item.single).map((item) => item.single!)
        : undefined,
      pendingHouseholdLanternClaims: pendingLanternItems.length
        ? pendingLanternItems.filter((item) => item.household).map((item) => item.household!)
        : undefined,
      pendingCeremonyRegistrations: pendingCeremonyItems.length
        ? pendingCeremonyItems.map((item) => item.request)
        : undefined,
      fallbackTempleId: templeId,
    };
    submitMutation.mutate(payload);
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        活動報名
      </Typography.Title>

      {!templeId ? (
        <Alert type="info" showIcon message="請先在上方選擇一間廟宇，才能辦理該廟的活動報名" />
      ) : (
        <>
          <Card>
            <Space direction="vertical" style={{ width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Checkbox checked={multi} onChange={(e) => setMulti(e.target.checked)}>
                  多人報名
                </Checkbox>
              </div>
              {multi ? (
                <Typography.Text type="secondary">已勾選多人報名：各項目分別選擇或輸入報名者</Typography.Text>
              ) : (
                <>
                  <Radio.Group
                    value={payerMode}
                    onChange={(e) => setPayerMode(e.target.value)}
                    options={[
                      { label: "已建檔信徒", value: "member" },
                      { label: "臨櫃香客（免建檔）", value: "walkIn" },
                    ]}
                    optionType="button"
                  />
                  {payerMode === "member" ? (
                    <MemberSelect
                      value={payerMemberId}
                      onChange={setPayerMemberId}
                      onSelectMember={(m) => setPayerMemberName(m?.name)}
                    />
                  ) : (
                    <Input
                      value={payerWalkInName}
                      maxLength={50}
                      placeholder="報名者姓名"
                      onChange={(e) => setPayerWalkInName(e.target.value)}
                    />
                  )}
                  <Typography.Text type="secondary">報名者只需要填這一次，下面所有項目都沿用這個人</Typography.Text>
                </>
              )}
            </Space>
          </Card>

          <Card>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text strong>請勾選要辦理的項目：</Typography.Text>
              <Checkbox.Group
                options={activityOptions}
                value={selected}
                onChange={(checked) => handleActivityChange(checked as ActivityKey[])}
              />
            </Space>
          </Card>

          {selected.includes("lantern") && (
            <LanternFields
              shared={shared}
              templeId={templeId}
              pendingItems={pendingLanternItems}
              onAddPending={(item) => setPendingLanternItems((prev) => [...prev, item])}
              onRemovePending={(index) => setPendingLanternItems((prev) => prev.filter((_, i) => i !== index))}
            />
          )}
          {selected.includes("donation") && (
            <DonationFields
              shared={shared}
              form={donationForm}
              ceremonies={ceremoniesQuery.data ?? []}
              templeId={templeId}
              pendingItems={pendingDonationItems}
              onAddPending={(item) => setPendingDonationItems((prev) => [...prev, item])}
              onRemovePending={(index) => setPendingDonationItems((prev) => prev.filter((_, i) => i !== index))}
            />
          )}
          {selected.includes("ceremony") && (
            <>
              {(ceremoniesQuery.data ?? []).length === 0 && (
                <Alert type="info" showIcon message="目前尚無活動，請總幹事至「建立活動」頁面先建立活動後才能報名" />
              )}
              <CeremonyRegistrationFields
                shared={shared}
                multi={multi}
                ceremonies={ceremoniesQuery.data ?? []}
                pendingItems={pendingCeremonyItems}
                onAddPending={(item) => setPendingCeremonyItems((prev) => [...prev, item])}
                onRemovePending={(index) => setPendingCeremonyItems((prev) => prev.filter((_, i) => i !== index))}
              />
            </>
          )}
          {selected.includes("gift") && (
            <GiftFields
              shared={shared}
              form={giftForm}
              ceremonies={ceremoniesQuery.data ?? []}
              templeId={templeId}
              pendingItems={pendingGiftItems}
              onAddPending={(item) => setPendingGiftItems((prev) => [...prev, item])}
              onRemovePending={(index) => setPendingGiftItems((prev) => prev.filter((_, i) => i !== index))}
            />
          )}

          {(selected.includes("donation") ||
            selected.includes("ceremony") ||
            selected.includes("gift") ||
            pendingLanternItems.length > 0 ||
            pendingCeremonyItems.length > 0 ||
            pendingDonationItems.length > 0 ||
            pendingGiftItems.length > 0) && (
            <Card className="submit-bar">
              <Space align="center" wrap style={{ width: "100%", justifyContent: "space-between" }}>
                <Typography.Text strong>
                  預估合計金額：
                  <span style={{ fontSize: 20, color: "#a8071a" }}>NT$ {previewTotal.toLocaleString()}</span>
                </Typography.Text>
                <Button type="primary" size="large" loading={submitMutation.isPending} onClick={handleSubmit}>
                  送出並開立收據
                </Button>
              </Space>
            </Card>
          )}
        </>
      )}

      <ReceiptsListCard />
    </Space>
  );
}
