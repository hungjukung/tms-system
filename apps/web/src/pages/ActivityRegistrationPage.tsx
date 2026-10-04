import { useEffect, useState } from "react";
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
  CeremonySeatDto,
  ClaimHouseholdLanternSlotsRequest,
  ClaimLanternSlotRequest,
  DonationType,
  GiftType,
  LANTERN_TYPE_OPTIONS,
  LanternSlotDto,
  LanternSlotStatus,
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
import { deleteReceipt, getWallSlots, listWalls, voidReceipt } from "../api/lantern";
import { getCeremonySeats, listCeremonies } from "../api/ceremony";
import { submitActivities } from "../api/activities";
import { getHouseholdMembers } from "../api/households";
import { MemberSelect } from "../components/MemberSelect";
import { HouseholdSelect } from "../components/HouseholdSelect";
import { openPrintWindow } from "../api/client";
import { getReceiptDetails } from "../api/print";
import { useAuth } from "../context/AuthContext";
import { ALL_TEMPLES, useTemple } from "../context/TempleContext";
import { exportReceiptCertificatePdf, exportRowsToExcel } from "../utils/export";
import { joinLanternType } from "../utils/lanternType";

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

type PendingCeremonyItem = {
  displayLabel: string;
  amount: number;
  request: RegisterCeremonyRequest;
};

function DonationFields({ form, ceremonies }: { form: any; ceremonies: CeremonyDto[] }) {
  const { user } = useAuth();
  const isDirector = user?.role === UserRole.DIRECTOR;
  const payerMode = Form.useWatch("payerMode", form) ?? "member";
  const ceremonyId = Form.useWatch("ceremonyId", form);

  return (
    <Card title="捐款收費">
      <Form form={form} layout="vertical">
        <Form.Item label="香客類型" name="payerMode" initialValue="member">
          <Radio.Group>
            <Radio.Button value="member">已建檔信徒</Radio.Button>
            <Radio.Button value="walkIn">臨櫃香客（免建檔）</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {payerMode === "member" ? (
          <Form.Item label="信徒" name="memberId" rules={[{ required: true, message: "請選擇信徒" }]}>
            <MemberSelect />
          </Form.Item>
        ) : (
          <Form.Item label="姓名" name="walkInName">
            <Input placeholder="可留空（不留名）" />
          </Form.Item>
        )}
        <Form.Item
          label="指定活動（選填）"
          name="ceremonyId"
          extra="指定後這筆捐款會獨立歸入該活動的收入，不計入下方「項目」分類統計"
        >
          <Select
            allowClear
            placeholder="不指定（計入一般捐款分類）"
            options={ceremonies.map((c) => ({ value: c.id, label: `${c.name}（${c.date}）` }))}
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
      </Form>
    </Card>
  );
}

function GiftFields({ form }: { form: any }) {
  const payerMode = Form.useWatch("payerMode", form) ?? "member";
  const giftTypes = (Form.useWatch("giftTypes", form) ?? []) as GiftType[];

  return (
    <Card title="送禮">
      <Form form={form} layout="vertical">
        <Form.Item label="捐贈者類型" name="payerMode" initialValue="member">
          <Radio.Group>
            <Radio.Button value="member">已建檔信徒</Radio.Button>
            <Radio.Button value="walkIn">臨櫃（免建檔）</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {payerMode === "member" ? (
          <Form.Item label="信徒" name="memberId" rules={[{ required: true, message: "請選擇信徒" }]}>
            <MemberSelect />
          </Form.Item>
        ) : (
          <Form.Item label="姓名" name="walkInName">
            <Input placeholder="可留空（不留名）" />
          </Form.Item>
        )}
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
      </Form>
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

function CeremonyRegistrationFields({
  ceremonies,
  pendingItems,
  onAddPending,
  onRemovePending,
}: {
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
  const selectedCeremony = ceremonies.find((c) => c.id === ceremonyId);
  const [seatModalOpen, setSeatModalOpen] = useState(false);
  const [selectedMemberName, setSelectedMemberName] = useState<string | undefined>();

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

  const needsSeatPicker = selectedCeremony?.totalSeats != null;
  const householdReadyForSeats = payerMode === "household" && !!householdId && headcount > 0;
  const showSeatPicker = needsSeatPicker && (payerMode !== "household" ? true : householdReadyForSeats);
  // 「不需要座位」只開放給個人（已建檔信徒／臨櫃）報名，整戶與認領整桌仍需要座位
  const canSkipSeat = needsSeatPicker && (payerMode === "member" || payerMode === "walkIn");

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
    if (!needsSeatPicker && payerMode === "table") {
      form.setFieldValue("payerMode", "member");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSeatPicker, payerMode]);

  const readyToAdd =
    !!ceremonyId &&
    (payerMode === "household"
      ? !!householdId && headcount > 0
      : payerMode === "walkIn"
        ? !!walkInName
        : !!memberId) &&
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
  const handleAdd = async () => {
    const values = await form.validateFields();
    const request: RegisterCeremonyRequest = {
      ceremonyId: values.ceremonyId,
      memberId: values.payerMode === "member" || values.payerMode === "table" ? values.memberId : undefined,
      walkInName: values.payerMode === "walkIn" ? values.walkInName : undefined,
      walkInAddress: values.payerMode === "walkIn" ? values.walkInAddress : undefined,
      householdId: values.payerMode === "household" ? values.householdId : undefined,
      householdSeatIndexes: values.payerMode === "household" ? values.householdSeatIndexes : undefined,
      amount: values.amount,
      wishText: values.wishText,
      seatIndex: values.payerMode === "household" || values.payerMode === "table" ? undefined : values.seatIndex,
      tableNumber: values.payerMode === "table" ? values.tableNumber : undefined,
      noSeatNeeded:
        (values.payerMode === "member" || values.payerMode === "walkIn") && values.noSeatNeeded ? true : undefined,
    };

    const ceremonyName = selectedCeremony?.name ?? "";
    let displayLabel: string;
    if (values.payerMode === "table") {
      displayLabel = `${ceremonyName}（${selectedMemberName ?? ""} 認領整桌${tableLabel ? `　${tableLabel}` : ""}）`;
    } else if (values.payerMode === "household") {
      const names = householdMembersQuery.data?.map((m) => m.name).join("、") ?? "";
      displayLabel = `${ceremonyName}（整戶 ${names}${householdSeatLabel ? `　${householdSeatLabel}` : ""}）`;
    } else {
      const payerName = values.payerMode === "member" ? (selectedMemberName ?? "") : values.walkInName;
      displayLabel = `${ceremonyName}（${payerName}${
        request.noSeatNeeded ? "，不需要座位" : seatLabel ? `　${seatLabel}` : ""
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
    });
    setSelectedMemberName(undefined);
  };

  const handleRemove = (index: number) => {
    onRemovePending(index);
    message.success("已從本次收據項目中移除");
  };

  return (
    <Card title="活動與祭祀報名">
      <Form form={form} layout="vertical">
        <Form.Item label="選擇活動" name="ceremonyId" rules={[{ required: true }]}>
          <Select
            placeholder="請選擇活動"
            options={ceremonies.map((c) => ({
              value: c.id,
              label: `${c.name}（${c.date}，${feeModeLabel[c.feeMode]}）${
                c.totalSeats ? `　座位 ${c.seatsAssigned}/${c.totalSeats}` : ""
              }`,
            }))}
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
            }}
          />
        </Form.Item>
        <Form.Item label="報名者類型" name="payerMode" initialValue="member">
          <Radio.Group>
            <Radio.Button value="member">已建檔信徒</Radio.Button>
            <Radio.Button value="walkIn">臨櫃香客（免建檔）</Radio.Button>
            <Radio.Button value="household">整戶報名</Radio.Button>
            {needsSeatPicker && <Radio.Button value="table">認領整桌</Radio.Button>}
          </Radio.Group>
        </Form.Item>
        {payerMode === "member" || payerMode === "table" ? (
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
        <Form.Item label="祈願內容" name="wishText">
          <Input.TextArea rows={2} placeholder="活動宣讀用，例如：闔家平安、消災解厄" />
        </Form.Item>
        <Form.Item
          label="金額"
          name="amount"
          rules={[{ required: true }]}
          extra={
            selectedCeremony?.feeMode === CeremonyFeeMode.FIXED_AMOUNT
              ? payerMode === "household"
                ? `此活動為固定金額，已自動算成單價 x ${headcount || "?"} 人`
                : payerMode === "table"
                  ? `此活動為固定金額，已自動算成單價 x 每桌 ${selectedCeremony.seatsPerTable ?? "?"} 人`
                  : "此活動為固定金額"
              : payerMode === "household"
                ? "隨喜金額，請直接輸入整戶合計金額"
                : payerMode === "table"
                  ? "隨喜金額，請直接輸入整桌合計金額"
                  : "隨喜金額，可自行輸入"
          }
        >
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            disabled={selectedCeremony?.feeMode === CeremonyFeeMode.FIXED_AMOUNT}
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

      {showSeatPicker && (
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
  onSelect,
  onConfirmMultiple,
}: {
  open: boolean;
  onClose: () => void;
  wallId?: string;
  wallName: string;
  /** 提供此欄位時進入多選模式（整戶點燈：一次選好幾盞燈），需選滿此數量才能確認 */
  maxSelections?: number;
  onSelect?: (slot: LanternSlotDto) => void;
  onConfirmMultiple?: (slots: LanternSlotDto[]) => void;
}) {
  const isMulti = maxSelections != null;
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<LanternSlotDto[]>([]);

  const slotsQuery = useQuery({
    queryKey: ["wall-slots", wallId],
    queryFn: () => getWallSlots(wallId!),
    enabled: open && !!wallId,
  });

  useEffect(() => {
    if (!open) setChosen([]);
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
      if (prev.length >= (maxSelections ?? 0)) return prev;
      return [...prev, slot];
    });
  };

  // 讓 Modal 寬度剛好容納最長的一排燈位（一橫排），不用捲軸就能看到整排；
  // .slot-cell 固定寬 90px、.table-seat-row 間距 10px（見 index.css），超出視窗寬度時才退而求其次維持 95vw
  const slots = slotsQuery.data ?? [];
  const maxRowLength = slots.length
    ? Math.max(
        ...Array.from(new Set(slots.map((s) => s.row))).map((row) => slots.filter((s) => s.row === row).length),
      )
    : 0;
  const rowWidth = maxRowLength > 0 ? maxRowLength * 90 + Math.max(maxRowLength - 1, 0) * 10 : 0;
  const modalWidth =
    maxRowLength > 0 ? Math.min(Math.max(rowWidth + 48, 700), Math.floor(window.innerWidth * 0.95)) : 700;

  return (
    <Modal
      title={isMulti ? `選擇燈位：${wallName}（已選 ${chosen.length} / ${maxSelections}）` : `選擇燈位：${wallName}`}
      open={open}
      onCancel={onClose}
      footer={
        isMulti ? (
          <Button
            type="primary"
            disabled={chosen.length !== maxSelections}
            onClick={() => onConfirmMultiple?.(chosen)}
          >
            確認選位（{chosen.length} / {maxSelections}）
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
            {Array.from(new Set((slotsQuery.data ?? []).map((s) => s.row)))
              .sort((a, b) => a - b)
              .map((row) => (
                <div key={row}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                    第 {row} 排
                  </Typography.Text>
                  <div className="table-seat-row">
                    {(slotsQuery.data ?? [])
                      .filter((s) => s.row === row)
                      .sort((a, b) => b.column - a.column)
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

function LanternFields({
  templeId,
  pendingItems,
  onAddPending,
  onRemovePending,
}: {
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
  const slotId = Form.useWatch("slotId", form);
  const slotLabel = Form.useWatch("slotLabel", form);
  const householdSlotIds = Form.useWatch("householdSlotIds", form) as string[] | undefined;
  const householdSlotLabel = Form.useWatch("householdSlotLabel", form);
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [selectedMemberName, setSelectedMemberName] = useState<string | undefined>();

  const wallsQuery = useQuery({ queryKey: ["walls", templeId], queryFn: () => listWalls(templeId) });
  const wall = wallsQuery.data?.find((w) => w.id === wallId);

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

  // 燈牆或整戶人數變動時，金額自動算成「單價」或「單價 x 人數」，仍可手動調整
  useEffect(() => {
    if (!wall) return;
    if (payerMode === "household") {
      if (headcount > 0) form.setFieldValue("amount", wall.slotPrice * headcount);
    } else {
      form.setFieldValue("amount", wall.slotPrice);
    }
  }, [wall, payerMode, headcount, form]);

  // 換燈牆時，太歲燈牆固定鎖定點燈內容為「太歲燈」；一般燈牆則清空選擇，改由使用者從下拉選單複選
  useEffect(() => {
    if (!wall) return;
    form.setFieldValue("lanternType", wall.isTaisuiWall ? [TAISUI_LANTERN_TYPE] : []);
  }, [wall, form]);

  // 換戶籍或換報名者類型時，已選的整戶燈位失效，一併清空
  useEffect(() => {
    form.setFieldValue("householdSlotIds", undefined);
    form.setFieldValue("householdSlotLabel", undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, payerMode]);

  const canPickSlot = !!wallId && (payerMode === "household" ? headcount > 0 : true);
  const readyToAdd =
    payerMode === "household" ? (householdSlotIds?.length ?? 0) === headcount && headcount > 0 : !!slotId;

  /**
   * 「加入」不會呼叫任何 API、不會建立資料庫紀錄，只是把這次點燈的內容暫存到本次收據的項目清單裡；
   * 真正的認領紀錄（含卡位）要到最後「送出並開立收據」才會建立，避免忘記送出時留下卡位卻沒收據的孤兒資料。
   */
  const handleAdd = async () => {
    const values = await form.validateFields();
    if (payerMode === "household") {
      const householdRequest: ClaimHouseholdLanternSlotsRequest = {
        wallId: values.wallId,
        householdId: values.householdId,
        slotIds: values.householdSlotIds,
        amount: values.amount,
      };
      const names = householdMembersQuery.data?.map((m) => m.name).join("、") ?? "";
      onAddPending({
        displayLabel: `${wall?.name ?? "點燈"}（整戶 ${names}${householdSlotLabel ? `　${householdSlotLabel}` : ""}）`,
        amount: values.amount,
        household: householdRequest,
      });
      message.success(`已為整戶 ${headcount} 人加入本次點燈項目`);
      form.setFieldsValue({ wallId: undefined, householdSlotIds: undefined, householdSlotLabel: undefined });
    } else {
      const lanternType = joinLanternType(values.lanternType);
      const singleRequest: ClaimLanternSlotRequest = {
        slotId: values.slotId,
        memberId: payerMode === "member" ? values.memberId : undefined,
        walkInName: payerMode === "walkIn" ? values.walkInName : undefined,
        wishText: values.wishText,
        petitionText: values.petitionText,
        lanternType: lanternType ?? undefined,
        amount: values.amount,
      };
      const payerName = payerMode === "member" ? (selectedMemberName ?? "") : values.walkInName;
      onAddPending({
        displayLabel: `${lanternType || wall?.name || "點燈"}（${payerName}${slotLabel ? `　${slotLabel}` : ""}）`,
        amount: values.amount,
        single: singleRequest,
      });
      message.success("已加入本次點燈項目");
      form.setFieldsValue({
        memberId: undefined,
        walkInName: undefined,
        wishText: undefined,
        petitionText: undefined,
        slotId: undefined,
        slotLabel: undefined,
      });
      setSelectedMemberName(undefined);
    }
  };

  const handleRemove = (index: number) => {
    onRemovePending(index);
    message.success("已從本次收據項目中移除");
  };

  return (
    <Card title="點燈">
      <Form form={form} layout="vertical">
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
        {payerMode !== "household" && (
          <>
            <Form.Item
              label="點燈內容"
              name="lanternType"
              extra={
                wall?.isTaisuiWall
                  ? "太歲燈牆固定點「太歲燈」，不開放更改"
                  : "可複選；留空則收據上顯示燈牆名稱"
              }
            >
              <Select
                mode="multiple"
                disabled={wall?.isTaisuiWall}
                options={(wall?.isTaisuiWall ? [TAISUI_LANTERN_TYPE] : LANTERN_TYPE_OPTIONS).map((v) => ({
                  value: v,
                  label: v,
                }))}
                placeholder="例如：光明燈、平安燈"
              />
            </Form.Item>
            <Form.Item label="祈願內容" name="wishText">
              <Input.TextArea rows={2} placeholder="例如：闔家平安、事業順利" />
            </Form.Item>
            <Form.Item label="疏文" name="petitionText">
              <Input.TextArea rows={4} placeholder="正式祈福文書內容（選填）" />
            </Form.Item>
          </>
        )}
        <Form.Item label="燈牆" name="wallId" rules={[{ required: true, message: "請選擇燈牆" }]}>
          <Select
            placeholder="尚無燈牆，請先新增"
            options={(wallsQuery.data ?? []).map((w) => ({
              value: w.id,
              label: `${w.name}（${w.year}年）　每盞 NT$ ${w.slotPrice.toLocaleString()}`,
            }))}
            onChange={() => {
              form.setFieldValue("slotId", undefined);
              form.setFieldValue("slotLabel", undefined);
              form.setFieldValue("householdSlotIds", undefined);
              form.setFieldValue("householdSlotLabel", undefined);
            }}
          />
        </Form.Item>
        <Form.Item label="金額" name="amount" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item name="slotId" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="slotLabel" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="householdSlotIds" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="householdSlotLabel" hidden>
          <Input />
        </Form.Item>
        <Form.Item label="燈位" required>
          <Space align="center" wrap>
            <Button disabled={!canPickSlot} onClick={() => setSlotModalOpen(true)}>
              {payerMode === "household"
                ? householdSlotIds?.length
                  ? "重新選擇燈位"
                  : `選擇燈位（需選 ${headcount || "?"} 盞）`
                : slotId
                  ? "重新選擇燈位"
                  : "選擇燈位"}
            </Button>
            {payerMode === "household"
              ? householdSlotLabel && <Tag color="green">已選 {householdSlotLabel}</Tag>
              : slotLabel && <Tag color="green">已選 {slotLabel}</Tag>}
          </Space>
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
          onSelect={
            payerMode === "household"
              ? undefined
              : (slot) => {
                  form.setFieldValue("slotId", slot.id);
                  form.setFieldValue("slotLabel", slot.code);
                  setSlotModalOpen(false);
                }
          }
          onConfirmMultiple={
            payerMode === "household"
              ? (slots) => {
                  form.setFieldValue(
                    "householdSlotIds",
                    slots.map((s) => s.id),
                  );
                  form.setFieldValue("householdSlotLabel", slots.map((s) => s.code).join("、"));
                  setSlotModalOpen(false);
                }
              : undefined
          }
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
  const [donationForm] = Form.useForm();
  const [giftForm] = Form.useForm();

  const ceremoniesQuery = useQuery({
    queryKey: ["ceremonies", templeId, "active"],
    queryFn: () => listCeremonies(templeId, true),
    enabled: !!templeId,
  });

  const donationAmount = Form.useWatch("amount", donationForm);
  const previewTotal =
    pendingLanternItems.reduce((sum, item) => sum + item.amount, 0) +
    pendingCeremonyItems.reduce((sum, item) => sum + item.amount, 0) +
    (selected.includes("donation") ? Number(donationAmount) || 0 : 0);

  const submitMutation = useMutation({
    mutationFn: submitActivities,
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      await openPrintWindow(`/print/receipt/${result.receipt.id}`);

      message.success("已開立收據");
      donationForm.resetFields();
      giftForm.resetFields();
      setPendingLanternItems([]);
      setPendingCeremonyItems([]);
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
    const allPendingItems = [...pendingLanternItems, ...pendingCeremonyItems];

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

    let donationValues: any;
    let giftValues: any;
    try {
      if (selected.includes("donation")) donationValues = await donationForm.validateFields();
      if (selected.includes("gift")) giftValues = await giftForm.validateFields();
    } catch {
      return; // antd 已在欄位上顯示驗證錯誤
    }

    if (!templeId) {
      message.warning("請先在上方選擇一間廟宇");
      return;
    }

    const payload: SubmitActivitiesRequest = {
      donation: donationValues
        ? {
            templeId,
            memberId: donationValues.payerMode === "member" ? donationValues.memberId : undefined,
            walkInName: donationValues.payerMode === "walkIn" ? donationValues.walkInName : undefined,
            type: donationValues.type ?? DonationType.GENERAL,
            amount: donationValues.amount,
            note: donationValues.note,
            customItem: donationValues.customItem,
            quantity: donationValues.quantity,
            ceremonyId: donationValues.ceremonyId || undefined,
          }
        : undefined,
      gift: giftValues
        ? {
            templeId,
            memberId: giftValues.payerMode === "member" ? giftValues.memberId : undefined,
            walkInName: giftValues.payerMode === "walkIn" ? giftValues.walkInName : undefined,
            items: (giftValues.giftTypes as GiftType[]).map((giftType) => ({
              giftType,
              quantity: giftValues.quantities?.[giftType] || 1,
            })),
          }
        : undefined,
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
              templeId={templeId}
              pendingItems={pendingLanternItems}
              onAddPending={(item) => setPendingLanternItems((prev) => [...prev, item])}
              onRemovePending={(index) => setPendingLanternItems((prev) => prev.filter((_, i) => i !== index))}
            />
          )}
          {selected.includes("donation") && (
            <DonationFields form={donationForm} ceremonies={ceremoniesQuery.data ?? []} />
          )}
          {selected.includes("ceremony") && (
            <>
              {(ceremoniesQuery.data ?? []).length === 0 && (
                <Alert type="info" showIcon message="目前尚無活動，請總幹事至「建立活動」頁面先建立活動後才能報名" />
              )}
              <CeremonyRegistrationFields
                ceremonies={ceremoniesQuery.data ?? []}
                pendingItems={pendingCeremonyItems}
                onAddPending={(item) => setPendingCeremonyItems((prev) => [...prev, item])}
                onRemovePending={(index) => setPendingCeremonyItems((prev) => prev.filter((_, i) => i !== index))}
              />
            </>
          )}
          {selected.includes("gift") && <GiftFields form={giftForm} />}

          {(selected.includes("donation") ||
            selected.includes("ceremony") ||
            selected.includes("gift") ||
            pendingLanternItems.length > 0 ||
            pendingCeremonyItems.length > 0) && (
            <Card>
              <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
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
