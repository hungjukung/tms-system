import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import {
  CeremonyDto,
  CeremonyFeeMode,
  LANTERN_TYPE_OPTIONS,
  LanternSlotDto,
  LanternSlotStatus,
  LanternWallDto,
  TAISUI_LANTERN_TYPE,
  UserRole,
} from "@tms/shared";
import {
  createCeremony,
  deleteCeremony,
  getCeremonyReport,
  getCeremonySeats,
  listCeremonies,
  updateCeremony,
} from "../api/ceremony";
import {
  createWall,
  deleteReceipt,
  deleteWall,
  generateSlots,
  getWallSlots,
  listWalls,
  updateClaim,
  updateWall,
} from "../api/lantern";
import { openPrintWindow } from "../api/client";
import { MemberSelect } from "../components/MemberSelect";
import { useAuth } from "../context/AuthContext";
import { ALL_TEMPLES, useTemple } from "../context/TempleContext";
import { exportRowsToExcel } from "../utils/export";
import { joinLanternType, splitLanternType } from "../utils/lanternType";

type ActivityType = "ceremony" | "lanternWall";

const activityTypeOptions: { label: string; value: ActivityType }[] = [
  { label: "活動", value: "ceremony" },
  { label: "點燈牆", value: "lanternWall" },
];

const feeModeLabel: Record<CeremonyFeeMode, string> = {
  [CeremonyFeeMode.FREE_WILL]: "隨喜",
  [CeremonyFeeMode.FIXED_AMOUNT]: "固定金額",
};

function CreateCeremonyForm({ templeId }: { templeId: string }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const feeMode = Form.useWatch("feeMode", form) ?? CeremonyFeeMode.FREE_WILL;
  const tableCount = Form.useWatch("tableCount", form);
  const seatsPerTable = Form.useWatch("seatsPerTable", form);

  const mutation = useMutation({
    mutationFn: createCeremony,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceremonies"] });
      form.resetFields();
    },
  });

  return (
    <Card title="新增活動">
      <Form
        form={form}
        layout="vertical"
        initialValues={{ feeMode: CeremonyFeeMode.FREE_WILL, date: dayjs() }}
        onFinish={(values) =>
          mutation.mutate({
            templeId,
            name: values.name,
            date: (values.date as Dayjs).format("YYYY-MM-DD"),
            feeMode: values.feeMode,
            fixedAmount: values.feeMode === CeremonyFeeMode.FIXED_AMOUNT ? values.fixedAmount : undefined,
            description: values.description,
            tableCount: values.tableCount || undefined,
            seatsPerTable: values.seatsPerTable || undefined,
            registrationDeadline: values.registrationDeadline
              ? (values.registrationDeadline as Dayjs).format("YYYY-MM-DD")
              : undefined,
          })
        }
      >
        <Form.Item label="活動名稱" name="name" rules={[{ required: true }]}>
          <Input placeholder="例如：中元普渡、消災活動" />
        </Form.Item>
        <Form.Item label="日期" name="date" rules={[{ required: true }]}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          label="報名期限（選填，超過此日期後活動報名頁將自動隱藏此活動）"
          name="registrationDeadline"
        >
          <DatePicker style={{ width: "100%" }} placeholder="不填則不設限" />
        </Form.Item>
        <Form.Item label="收費方式" name="feeMode">
          <Radio.Group>
            <Radio.Button value={CeremonyFeeMode.FREE_WILL}>隨喜</Radio.Button>
            <Radio.Button value={CeremonyFeeMode.FIXED_AMOUNT}>固定金額</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {feeMode === CeremonyFeeMode.FIXED_AMOUNT && (
          <Form.Item label="固定金額" name="fixedAmount" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        )}
        <Form.Item label="說明" name="description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Space.Compact block>
          <Form.Item label="桌數（選填，設定後報名會自動配位）" name="tableCount" style={{ width: "50%" }}>
            <InputNumber style={{ width: "100%" }} min={1} placeholder="例如：10" />
          </Form.Item>
          <Form.Item label="每桌人數" name="seatsPerTable" style={{ width: "50%" }}>
            <InputNumber style={{ width: "100%" }} min={1} placeholder="例如：10" />
          </Form.Item>
        </Space.Compact>
        {tableCount > 0 && seatsPerTable > 0 && (
          <Alert
            type="info"
            style={{ marginBottom: 16 }}
            message={`共 ${tableCount} 桌 × ${seatsPerTable} 人 = ${tableCount * seatsPerTable} 個座位，報名時將依序自動配發座位號碼（例如 1-1 代表第一桌一號）`}
          />
        )}
        <Button type="primary" htmlType="submit" block loading={mutation.isPending}>
          建立活動
        </Button>
      </Form>
    </Card>
  );
}

function EditCeremonyModal({ ceremony, onClose }: { ceremony: CeremonyDto; onClose: () => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const feeMode = Form.useWatch("feeMode", form) ?? ceremony.feeMode;
  const hasRegistrations = ceremony.registrationCount > 0;

  const mutation = useMutation({
    mutationFn: (values: Parameters<typeof updateCeremony>[1]) => updateCeremony(ceremony.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceremonies"] });
      message.success("已更新活動");
      onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "更新失敗，請重試");
    },
  });

  return (
    <Modal title="編輯活動" open onCancel={onClose} footer={null} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: ceremony.name,
          date: dayjs(ceremony.date),
          feeMode: ceremony.feeMode,
          fixedAmount: ceremony.fixedAmount ?? undefined,
          description: ceremony.description ?? undefined,
          tableCount: ceremony.tableCount ?? undefined,
          seatsPerTable: ceremony.seatsPerTable ?? undefined,
          registrationDeadline: ceremony.registrationDeadline ? dayjs(ceremony.registrationDeadline) : undefined,
        }}
        onFinish={(values) =>
          mutation.mutate({
            name: values.name,
            date: (values.date as Dayjs).format("YYYY-MM-DD"),
            feeMode: values.feeMode,
            fixedAmount: values.feeMode === CeremonyFeeMode.FIXED_AMOUNT ? values.fixedAmount : null,
            description: values.description || null,
            tableCount: values.tableCount || null,
            seatsPerTable: values.seatsPerTable || null,
            registrationDeadline: values.registrationDeadline
              ? (values.registrationDeadline as Dayjs).format("YYYY-MM-DD")
              : null,
          })
        }
      >
        <Form.Item label="活動名稱" name="name" rules={[{ required: true }]}>
          <Input placeholder="例如：中元普渡、消災活動" />
        </Form.Item>
        <Form.Item label="日期" name="date" rules={[{ required: true }]}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          label="報名期限（選填，超過此日期後活動報名頁將自動隱藏此活動）"
          name="registrationDeadline"
        >
          <DatePicker style={{ width: "100%" }} placeholder="不填則不設限" />
        </Form.Item>
        <Form.Item label="收費方式" name="feeMode">
          <Radio.Group>
            <Radio.Button value={CeremonyFeeMode.FREE_WILL}>隨喜</Radio.Button>
            <Radio.Button value={CeremonyFeeMode.FIXED_AMOUNT}>固定金額</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {feeMode === CeremonyFeeMode.FIXED_AMOUNT && (
          <Form.Item label="固定金額" name="fixedAmount" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        )}
        <Form.Item label="說明" name="description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Space.Compact block>
          <Form.Item label="桌數（可增加，不可低於目前已配發的座位）" name="tableCount" style={{ width: "50%" }}>
            <InputNumber style={{ width: "100%" }} min={1} placeholder="例如：10" />
          </Form.Item>
          <Form.Item label="每桌人數" name="seatsPerTable" style={{ width: "50%" }}>
            <InputNumber style={{ width: "100%" }} min={1} placeholder="例如：10" disabled={hasRegistrations} />
          </Form.Item>
        </Space.Compact>
        {hasRegistrations && (
          <Alert
            type="warning"
            style={{ marginBottom: 16 }}
            message="此活動已有信眾報名，每桌人數無法再修改；桌數仍可增加以加開座位，但不能縮減到低於目前已配發的座位範圍"
          />
        )}
        <Button type="primary" htmlType="submit" block loading={mutation.isPending}>
          儲存變更
        </Button>
      </Form>
    </Modal>
  );
}

function CeremonyListCard({ templeId }: { templeId: string }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [editingCeremony, setEditingCeremony] = useState<CeremonyDto | null>(null);
  const [detailCeremony, setDetailCeremony] = useState<CeremonyDto | null>(null);
  const [showExpired, setShowExpired] = useState(true);
  const ceremoniesQuery = useQuery({
    queryKey: ["ceremonies", templeId],
    queryFn: () => listCeremonies(templeId),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => deleteCeremony(id, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceremonies"] });
      message.success("已刪除活動");
    },
    onError: (err: any, variables) => {
      const registrationCount = err?.response?.data?.registrationCount;
      if (err?.response?.status === 409 && typeof registrationCount === "number" && !variables.force) {
        // 已有報名紀錄：再跟總幹事確認一次，確認後才強制刪除（報名紀錄會一併移除，收據金額仍保留在財務紀錄中）
        modal.confirm({
          title: "此活動已有信眾報名",
          content: `已有 ${registrationCount} 筆信眾報名並產生收據。再次確認後將一併刪除這些報名紀錄（收據金額仍會保留在財務紀錄中，但項目說明會顯示為空）。確定要刪除嗎？`,
          okText: "確定刪除",
          okButtonProps: { danger: true },
          cancelText: "取消",
          onOk: () => deleteMutation.mutate({ id: variables.id, force: true }),
        });
        return;
      }
      message.error(err?.response?.data?.message ?? "刪除失敗，請重試");
    },
  });

  const expireMutation = useMutation({
    mutationFn: (id: string) =>
      updateCeremony(id, { registrationDeadline: dayjs().subtract(1, "day").format("YYYY-MM-DD") }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceremonies"] });
      message.success("已設定為過期");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "設定失敗，請重試");
    },
  });

  // 報名期限未設定（不限）時，改以活動日期本身是否已過來判斷是否過期
  const isCeremonyExpired = (record: CeremonyDto) =>
    record.registrationDeadline
      ? dayjs(record.registrationDeadline).isBefore(dayjs(), "day")
      : dayjs(record.date).isBefore(dayjs(), "day");

  const ceremonies = ceremoniesQuery.data ?? [];
  const visibleCeremonies = showExpired ? ceremonies : ceremonies.filter((record) => !isCeremonyExpired(record));

  return (
    <Card
      title="活動列表"
      extra={
        <Space>
          <Typography.Text>顯示已過期</Typography.Text>
          <Switch checked={showExpired} onChange={setShowExpired} />
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={ceremoniesQuery.isLoading}
        dataSource={visibleCeremonies}
        pagination={false}
        columns={[
          {
            title: "名稱",
            dataIndex: "name",
            render: (name: string, record: CeremonyDto) => (
              <Typography.Link onClick={() => setDetailCeremony(record)}>{name}</Typography.Link>
            ),
          },
          { title: "日期", dataIndex: "date" },
          {
            title: "收費方式",
            dataIndex: "feeMode",
            render: (m: CeremonyFeeMode, record: CeremonyDto) => (
              <Tag>
                {feeModeLabel[m]}
                {m === CeremonyFeeMode.FIXED_AMOUNT ? ` NT$${record.fixedAmount}` : ""}
              </Tag>
            ),
          },
          { title: "說明", dataIndex: "description" },
          {
            title: "座位",
            render: (_: unknown, record: CeremonyDto) =>
              record.totalSeats ? (
                <Tag color={record.seatsAssigned >= record.totalSeats ? "red" : "green"}>
                  {record.seatsAssigned}/{record.totalSeats}（{record.tableCount} 桌 × {record.seatsPerTable} 人）
                </Tag>
              ) : (
                <Typography.Text type="secondary">未設定</Typography.Text>
              ),
          },
          {
            title: "報名期限",
            render: (_: unknown, record: CeremonyDto) => {
              const expired = isCeremonyExpired(record);
              if (!record.registrationDeadline) {
                return (
                  <Space size={4}>
                    <Typography.Text type="secondary">不限</Typography.Text>
                    {expired && <Tag color="red">已過期</Tag>}
                  </Space>
                );
              }
              return (
                <Space size={4}>
                  <span>{record.registrationDeadline}</span>
                  <Tag color={expired ? "red" : "green"}>{expired ? "已過期" : "報名中"}</Tag>
                </Space>
              );
            },
          },
          {
            title: "累計報名",
            render: (_: unknown, record: CeremonyDto) => `${record.registrationCount} 筆`,
          },
          {
            title: "累計收款",
            render: (_: unknown, record: CeremonyDto) => `NT$ ${record.totalAmount.toLocaleString()}`,
          },
          {
            title: "操作",
            render: (_: unknown, record: CeremonyDto) => (
              <Space>
                <Button size="small" onClick={() => setEditingCeremony(record)}>
                  編輯
                </Button>
                {!isCeremonyExpired(record) && (
                  <Popconfirm
                    title="確定要將此活動設為過期嗎？"
                    description="設定後活動報名頁將立即隱藏此活動，之後仍可在「編輯」中調整報名期限來恢復"
                    okText="設為過期"
                    cancelText="取消"
                    onConfirm={() => expireMutation.mutate(record.id)}
                  >
                    <Button size="small" loading={expireMutation.isPending}>
                      設為過期
                    </Button>
                  </Popconfirm>
                )}
                <Popconfirm
                  title="確定要刪除此活動嗎？"
                  description="若此活動已有信眾報名，會再跟你確認一次"
                  okText="刪除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => deleteMutation.mutate({ id: record.id, force: false })}
                >
                  <Button danger size="small" loading={deleteMutation.isPending}>
                    刪除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {editingCeremony && (
        <EditCeremonyModal ceremony={editingCeremony} onClose={() => setEditingCeremony(null)} />
      )}
      {detailCeremony && (
        <CeremonyDetailModal ceremony={detailCeremony} onClose={() => setDetailCeremony(null)} />
      )}
    </Card>
  );
}

function CeremonyDetailModal({ ceremony, onClose }: { ceremony: CeremonyDto; onClose: () => void }) {
  const { user } = useAuth();
  const canDeleteReceipt = user?.role === UserRole.DIRECTOR;
  const queryClient = useQueryClient();
  const reportQuery = useQuery({
    queryKey: ["ceremony-report", ceremony.id],
    queryFn: () => getCeremonyReport(ceremony.id),
  });
  const deleteReceiptMutation = useMutation({
    mutationFn: (receiptId: string) => deleteReceipt(receiptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceremony-report", ceremony.id] });
      queryClient.invalidateQueries({ queryKey: ["ceremonies"] });
    },
  });
  const seatsQuery = useQuery({
    queryKey: ["ceremony-seats", ceremony.id],
    queryFn: () => getCeremonySeats(ceremony.id),
    enabled: ceremony.totalSeats != null,
  });

  const registrations = reportQuery.data?.registrations ?? [];
  const seats = seatsQuery.data ?? [];
  const donations = reportQuery.data?.donations ?? [];
  const donationTotal = reportQuery.data?.donationTotal ?? 0;
  const expenses = reportQuery.data?.expenses ?? [];
  const expenseTotal = reportQuery.data?.expenseTotal ?? 0;

  const handleExportDonations = () => {
    exportRowsToExcel(
      `活動捐款_${ceremony.name}.xlsx`,
      "活動捐款",
      ["捐款人", "金額", "備註", "時間"],
      donations.map((d) => [d.payerName || "（未留姓名）", d.amount, d.note ?? "", dayjs(d.createdAt).format("YYYY-MM-DD HH:mm")]),
    );
  };

  const handleExportExpenses = () => {
    exportRowsToExcel(
      `活動支出_${ceremony.name}.xlsx`,
      "活動支出",
      ["分類", "金額", "說明", "日期"],
      expenses.map((e) => [e.category, e.amount, e.description ?? "", e.occurredAt]),
    );
  };

  const handleExportRoster = () => {
    exportRowsToExcel(
      `名單_${ceremony.name}.xlsx`,
      "報名名單",
      ["參加者", "金額", "座位", "報名時間"],
      registrations.map((r) => [
        r.participantName || "（未留姓名）",
        r.amount,
        r.seatNumber ?? "",
        dayjs(r.createdAt).format("YYYY-MM-DD HH:mm"),
      ]),
    );
  };

  const handleExportSeatChart = () => {
    if (!ceremony.tableCount || !ceremony.seatsPerTable) return;
    const headers = ["桌次", ...Array.from({ length: ceremony.seatsPerTable }, (_, i) => `${i + 1}號`)];
    const rows: (string | number)[][] = Array.from({ length: ceremony.tableCount }, (_, t) => {
      const tableNumber = t + 1;
      const tableSeats = seats
        .filter((s) => s.tableNumber === tableNumber)
        .sort((a, b) => a.seatInTable - b.seatInTable);
      return [`第${tableNumber}桌`, ...tableSeats.map((s) => s.participantName || "")];
    });
    exportRowsToExcel(`座位表_${ceremony.name}.xlsx`, "座位表", headers, rows);
  };

  // 讓 Modal 寬度剛好容納一整桌（一橫排），不用捲軸就能看到整桌座位；
  // .slot-cell 固定寬 90px、.table-seat-row 間距 10px（見 index.css），超出視窗寬度時才退而求其次維持 95vw
  const seatsPerTable = ceremony.seatsPerTable ?? 0;
  const seatRowWidth = seatsPerTable > 0 ? seatsPerTable * 90 + Math.max(seatsPerTable - 1, 0) * 10 : 0;
  const modalWidth =
    seatsPerTable > 0
      ? Math.min(Math.max(seatRowWidth + 120, 800), Math.floor(window.innerWidth * 0.95))
      : 800;

  return (
    <Modal title={`活動詳情：${ceremony.name}`} open onCancel={onClose} footer={null} width={modalWidth}>
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="日期">{ceremony.date}</Descriptions.Item>
          <Descriptions.Item label="收費方式">
            {feeModeLabel[ceremony.feeMode]}
            {ceremony.feeMode === CeremonyFeeMode.FIXED_AMOUNT ? ` NT$${ceremony.fixedAmount}` : ""}
          </Descriptions.Item>
          <Descriptions.Item label="報名期限" span={2}>
            {ceremony.registrationDeadline ? (
              <Space size={4}>
                <span>{ceremony.registrationDeadline}</span>
                <Tag color={dayjs(ceremony.registrationDeadline).isBefore(dayjs(), "day") ? "red" : "green"}>
                  {dayjs(ceremony.registrationDeadline).isBefore(dayjs(), "day") ? "已過期" : "報名中"}
                </Tag>
              </Space>
            ) : (
              <Space size={4}>
                <span>不限</span>
                {dayjs(ceremony.date).isBefore(dayjs(), "day") && <Tag color="red">已過期</Tag>}
              </Space>
            )}
          </Descriptions.Item>
          {ceremony.description && (
            <Descriptions.Item label="說明" span={2}>
              {ceremony.description}
            </Descriptions.Item>
          )}
          {ceremony.totalSeats != null && (
            <Descriptions.Item label="座位" span={2}>
              {ceremony.seatsAssigned} / {ceremony.totalSeats}（{ceremony.tableCount} 桌 × {ceremony.seatsPerTable} 人）
            </Descriptions.Item>
          )}
        </Descriptions>

        <Space size="large" wrap>
          <Statistic title="累計報名" value={ceremony.registrationCount} suffix="筆" />
          <Statistic title="累計收款（報名費）" value={ceremony.totalAmount} prefix="NT$" />
          <Statistic title="活動本身的捐款" value={donationTotal} prefix="NT$" valueStyle={{ color: "#a8071a" }} />
          <Statistic title="列入活動計算的支出" value={expenseTotal} prefix="NT$" valueStyle={{ color: "#1a5c26" }} />
        </Space>

        {ceremony.totalSeats != null && (
          <Card
            size="small"
            title="座位表"
            loading={seatsQuery.isLoading}
            extra={
              <Button size="small" onClick={handleExportSeatChart}>
                匯出座位表 Excel
              </Button>
            }
          >
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              {Array.from(new Set(seats.map((s) => s.tableNumber))).map((tableNumber) => (
                <div key={tableNumber}>
                  <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                    第 {tableNumber} 桌
                  </Typography.Text>
                  <div className="table-seat-row">
                    {seats
                      .filter((s) => s.tableNumber === tableNumber)
                      .map((seat) => (
                        <div
                          key={seat.seatIndex}
                          className={`slot-cell ${seat.status === "EMPTY" ? "empty" : "claimed"}`}
                          title={seat.participantName || (seat.status === "EMPTY" ? "空位" : "已入座")}
                        >
                          <div>
                            {seat.tableNumber}桌{seat.seatInTable}號
                          </div>
                          {seat.participantName && <div style={{ fontSize: 12 }}>{seat.participantName}</div>}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </Space>
          </Card>
        )}

        <Card
          size="small"
          title="報名名單"
          extra={
            <Button size="small" onClick={handleExportRoster}>
              匯出名單 Excel
            </Button>
          }
        >
          <Table
            size="small"
            rowKey="id"
            loading={reportQuery.isLoading}
            dataSource={registrations}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            columns={[
              { title: "參加者", dataIndex: "participantName", render: (v: string) => v || "（未留姓名）" },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
              { title: "座位", dataIndex: "seatNumber", render: (v: string | null) => v ?? "-" },
              {
                title: "報名時間",
                dataIndex: "createdAt",
                render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
              },
              {
                title: "操作",
                render: (_, record) =>
                  record.receiptId ? (
                    <Space>
                      <Button size="small" onClick={() => openPrintWindow(`/print/receipt/${record.receiptId}`)}>
                        補印
                      </Button>
                      {canDeleteReceipt && (
                        <Popconfirm
                          title="確定要永久刪除這張收據嗎？"
                          description="此操作無法復原，會一併移除這筆報名紀錄並釋放座位，且會影響財務報表的歷史金額加總，僅建議用於清除明顯建錯/重複的報名。"
                          okText="永久刪除"
                          okButtonProps={{ danger: true, loading: deleteReceiptMutation.isPending }}
                          cancelText="取消"
                          onConfirm={() => deleteReceiptMutation.mutate(record.receiptId!)}
                        >
                          <Button danger size="small">
                            刪除收據
                          </Button>
                        </Popconfirm>
                      )}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">找不到收據</Typography.Text>
                  ),
              },
            ]}
          />
        </Card>

        <Card
          size="small"
          title="活動本身的捐款（獨立於報名費，不計入一般捐款統計）"
          extra={
            donations.length > 0 && (
              <Button size="small" onClick={handleExportDonations}>
                匯出捐款明細 Excel
              </Button>
            )
          }
        >
          <Table
            size="small"
            rowKey={(d) => `${d.payerName}-${d.amount}-${d.createdAt}`}
            loading={reportQuery.isLoading}
            dataSource={donations}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: "此活動尚無指定捐款" }}
            columns={[
              { title: "捐款人", dataIndex: "payerName", render: (v: string) => v || "（未留姓名）" },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
              { title: "備註", dataIndex: "note", render: (v: string | null) => v ?? "-" },
              {
                title: "時間",
                dataIndex: "createdAt",
                render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
              },
            ]}
          />
        </Card>

        <Card
          size="small"
          title="列入活動計算的支出（仍計入財務報表總支出，此處僅為額外統計）"
          extra={
            expenses.length > 0 && (
              <Button size="small" onClick={handleExportExpenses}>
                匯出支出明細 Excel
              </Button>
            )
          }
        >
          <Table
            size="small"
            rowKey={(e) => `${e.category}-${e.amount}-${e.occurredAt}`}
            loading={reportQuery.isLoading}
            dataSource={expenses}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: "此活動尚無列入計算的支出" }}
            columns={[
              { title: "分類", dataIndex: "category" },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
              { title: "說明", dataIndex: "description", render: (v: string | null) => v ?? "-" },
              { title: "日期", dataIndex: "occurredAt" },
            ]}
          />
        </Card>
      </Space>
    </Modal>
  );
}

function EditClaimModal({
  slot,
  wallName,
  wallIsTaisuiWall,
  onClose,
}: {
  slot: LanternSlotDto;
  wallName?: string;
  wallIsTaisuiWall?: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const claim = slot.claim!;
  const payerMode = Form.useWatch("payerMode", form) ?? (claim.memberId ? "member" : "walkIn");

  const mutation = useMutation({
    mutationFn: (values: {
      memberId: string | null;
      walkInName: string | null;
      wishText: string | null;
      petitionText: string | null;
      lanternType: string | null;
    }) => updateClaim(claim.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wall-slots", slot.wallId] });
      message.success("已更新燈位資料");
      onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "更新失敗，請重試");
    },
  });

  return (
    <Modal title={`編輯燈位：${slot.code}`} open onCancel={onClose} footer={null} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          payerMode: claim.memberId ? "member" : "walkIn",
          memberId: claim.memberId ?? undefined,
          walkInName: claim.memberId ? undefined : claim.memberName,
          wishText: claim.wishText ?? undefined,
          petitionText: claim.petitionText ?? undefined,
          lanternType: wallIsTaisuiWall ? [TAISUI_LANTERN_TYPE] : splitLanternType(claim.lanternType),
        }}
        onFinish={(values) =>
          mutation.mutate({
            memberId: values.payerMode === "member" ? values.memberId : null,
            walkInName: values.payerMode === "walkIn" ? values.walkInName : null,
            wishText: values.wishText || null,
            petitionText: values.petitionText || null,
            lanternType: joinLanternType(values.lanternType),
          })
        }
      >
        <Form.Item label="類型" name="payerMode">
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
          <Form.Item label="姓名" name="walkInName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        )}
        <Form.Item
          label="點燈內容"
          name="lanternType"
          extra={
            wallIsTaisuiWall
              ? "太歲燈牆固定點「太歲燈」，不開放更改"
              : `可複選；留空則收據上顯示燈牆名稱${wallName ? `「${wallName}」` : ""}`
          }
        >
          <Select
            mode="multiple"
            disabled={wallIsTaisuiWall}
            options={(wallIsTaisuiWall ? [TAISUI_LANTERN_TYPE] : LANTERN_TYPE_OPTIONS).map((v) => ({
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
        <Alert
          type="info"
          style={{ marginBottom: 16 }}
          message={`此燈位金額 NT$ ${claim.amount.toLocaleString()}（金額已核發收據，如需更正請改用「作廢收據」重新開立）`}
        />
        <Button type="primary" htmlType="submit" block loading={mutation.isPending}>
          儲存變更
        </Button>
      </Form>
    </Modal>
  );
}

const DEFAULT_PICKER_ROWS = 5;
const DEFAULT_PICKER_COLUMNS = 10;

/**
 * 燈牆形狀畫布：預設 10x5 空格，可自行調整排數/每排格數；點擊或按住滑鼠左鍵拖曳來選取實際要建立燈位的格子
 * （由灰轉紅），因為實體燈牆形狀不一定是完整矩形，故改用逐格選取而非單純輸入排數 x 每排燈數。
 * 拖曳採矩形框選（從拖曳起點到目前游標位置之間的整個方形範圍），而非只選滑鼠實際劃過的路徑。
 */
function LanternSlotPicker({
  onSubmit,
  submitting,
  errorMessage,
}: {
  onSubmit: (values: { prefix: string; positions: { row: number; column: number }[] }) => void;
  submitting: boolean;
  errorMessage?: string;
}) {
  const [prefix, setPrefix] = useState("A");
  const [gridRows, setGridRows] = useState(DEFAULT_PICKER_ROWS);
  const [gridColumns, setGridColumns] = useState(DEFAULT_PICKER_COLUMNS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const draggingRef = useRef(false);
  const dragModeRef = useRef<"select" | "deselect">("select");
  const dragAnchorRef = useRef<{ row: number; col: number } | null>(null);
  const preDragSelectedRef = useRef<Set<string>>(new Set());

  const cellKey = (row: number, col: number) => `${row}-${col}`;

  // 從拖曳起點到目前這格畫出矩形範圍，套用到拖曳開始前的選取狀態上（即時預覽，方形範圍內全部一起選取/取消選取）
  const applyRectFromAnchor = (row: number, col: number) => {
    const anchor = dragAnchorRef.current;
    if (!anchor) return;
    const rMin = Math.min(anchor.row, row);
    const rMax = Math.max(anchor.row, row);
    const cMin = Math.min(anchor.col, col);
    const cMax = Math.max(anchor.col, col);
    const next = new Set(preDragSelectedRef.current);
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        if (dragModeRef.current === "select") next.add(cellKey(r, c));
        else next.delete(cellKey(r, c));
      }
    }
    setSelected(next);
  };

  const handleMouseDown = (row: number, col: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    dragModeRef.current = selected.has(cellKey(row, col)) ? "deselect" : "select";
    dragAnchorRef.current = { row, col };
    preDragSelectedRef.current = selected;
    draggingRef.current = true;
    applyRectFromAnchor(row, col);
  };

  const handleMouseEnter = (row: number, col: number) => () => {
    if (!draggingRef.current) return;
    applyRectFromAnchor(row, col);
  };

  useEffect(() => {
    const handleUp = () => {
      draggingRef.current = false;
      dragAnchorRef.current = null;
    };
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, []);

  // 縮小畫布時，移除超出新範圍的選取，避免殘留看不到卻仍會送出的燈位
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      let changed = false;
      for (const k of prev) {
        const [r, c] = k.split("-").map(Number);
        if (r <= gridRows && c <= gridColumns) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [gridRows, gridColumns]);

  const rowsArray = Array.from({ length: gridRows }, (_, i) => i + 1);
  const colsArray = Array.from({ length: gridColumns }, (_, i) => i + 1);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Space wrap>
        <Space>
          <Typography.Text>燈位前綴代碼</Typography.Text>
          <Input
            id="picker-prefix-input"
            style={{ width: 100 }}
            placeholder="例如：A"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </Space>
        <Space>
          <Typography.Text>排數</Typography.Text>
          <InputNumber id="picker-rows-input" min={1} max={60} value={gridRows} onChange={(v) => setGridRows(v || 1)} />
        </Space>
        <Space>
          <Typography.Text>每排格數</Typography.Text>
          <InputNumber
            id="picker-columns-input"
            min={1}
            max={60}
            value={gridColumns}
            onChange={(v) => setGridColumns(v || 1)}
          />
        </Space>
        <Button onClick={() => setSelected(new Set(rowsArray.flatMap((r) => colsArray.map((c) => cellKey(r, c)))))}>
          全選
        </Button>
        <Button onClick={() => setSelected(new Set())}>清除選取</Button>
      </Space>
      <Typography.Text type="secondary">
        點擊格子切換選取（灰色→紅色表示已選取成功），也可以按住滑鼠左鍵拖曳，拖曳起點到目前位置之間的整個方形範圍會一起被選取；空格不夠可調整上方排數／每排格數，或按「清除選取」重新開始
      </Typography.Text>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${gridColumns}, minmax(24px, 40px))`,
          gap: 4,
          userSelect: "none",
        }}
        onDragStart={(e) => e.preventDefault()}
        data-testid="lantern-slot-grid"
      >
        {rowsArray.flatMap((row) =>
          colsArray.map((col) => {
            const isSelected = selected.has(cellKey(row, col));
            return (
              <div
                key={cellKey(row, col)}
                onMouseDown={handleMouseDown(row, col)}
                onMouseEnter={handleMouseEnter(row, col)}
                data-testid={`lantern-slot-cell-${row}-${col}`}
                data-selected={isSelected}
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: isSelected ? "#c0504d" : "#d9d9d9",
                }}
              />
            );
          }),
        )}
      </div>
      <Alert type="info" message={`已選取 ${selected.size} 個燈位`} />
      <Button
        type="primary"
        block
        loading={submitting}
        disabled={!prefix.trim() || selected.size === 0}
        onClick={() =>
          onSubmit({
            prefix: prefix.trim(),
            positions: Array.from(selected).map((k) => {
              const [row, column] = k.split("-").map(Number);
              return { row, column };
            }),
          })
        }
      >
        建立燈位
      </Button>
      {errorMessage && (
        <Descriptions column={1}>
          <Descriptions.Item label="錯誤">{errorMessage}</Descriptions.Item>
        </Descriptions>
      )}
    </Space>
  );
}

function EditWallModal({ wall, onClose }: { wall: LanternWallDto; onClose: () => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [name, setName] = useState(wall.name);
  const [isTaisuiWall, setIsTaisuiWall] = useState(wall.isTaisuiWall);

  const mutation = useMutation({
    mutationFn: () => updateWall(wall.id, { name, isTaisuiWall }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["walls"] });
      message.success("已更新燈牆");
      onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "更新失敗，請重試");
    },
  });

  return (
    <Modal
      title="編輯點燈內容"
      open
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      okButtonProps={{ loading: mutation.isPending, disabled: !name.trim() }}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        修改後，之後補印該燈牆的單筆點燈收據會顯示新名稱；已開立的合併收據（與其他活動一起送出的收據）不受影響。
      </Typography.Paragraph>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：光明燈、平安燈" />
      <Checkbox
        checked={isTaisuiWall}
        onChange={(e) => setIsTaisuiWall(e.target.checked)}
        style={{ marginTop: 12 }}
      >
        太歲燈牆（點燈內容將固定鎖定為「太歲燈」，不開放選擇其他點燈內容）
      </Checkbox>
    </Modal>
  );
}

function LanternWallListCard({
  templeId,
  selectedWallId,
  onWallDeleted,
}: {
  templeId: string;
  selectedWallId?: string;
  onWallDeleted: (id: string) => void;
}) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [editingWall, setEditingWall] = useState<LanternWallDto | null>(null);
  const wallsQuery = useQuery({ queryKey: ["walls", templeId], queryFn: () => listWalls(templeId) });

  const deleteMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => deleteWall(id, force),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["walls"] });
      queryClient.invalidateQueries({ queryKey: ["wall-slots"] });
      message.success("已刪除燈牆");
      onWallDeleted(variables.id);
    },
    onError: (err: any, variables) => {
      const claimedCount = err?.response?.data?.claimedCount;
      if (err?.response?.status === 409 && typeof claimedCount === "number" && !variables.force) {
        // 已有信眾點燈：再跟總幹事確認一次（多一道確認避免誤刪），確認後才強制刪除
        modal.confirm({
          title: "此燈牆已有信眾點燈",
          content: `已有 ${claimedCount} 盞燈被點亮並產生收據。再次確認後將一併刪除這面燈牆與所有燈位（收據金額仍會保留在財務紀錄中，但項目說明會顯示為空）。此操作無法復原，確定要刪除嗎？`,
          okText: "確定刪除",
          okButtonProps: { danger: true },
          cancelText: "取消",
          onOk: () => deleteMutation.mutate({ id: variables.id, force: true }),
        });
        return;
      }
      message.error(err?.response?.data?.message ?? "刪除失敗，請重試");
    },
  });

  return (
    <Card title="燈牆列表">
      <Table
        rowKey="id"
        loading={wallsQuery.isLoading}
        dataSource={wallsQuery.data ?? []}
        pagination={false}
        columns={[
          {
            title: "名稱",
            dataIndex: "name",
            render: (name: string, record: LanternWallDto) => (
              <Space size={4}>
                {name}
                {record.id === selectedWallId && <Tag color="blue">使用中</Tag>}
                {record.isTaisuiWall && <Tag color="purple">太歲燈牆</Tag>}
              </Space>
            ),
          },
          { title: "年度", dataIndex: "year" },
          {
            title: "每盞燈價格",
            dataIndex: "slotPrice",
            render: (v: number) => `NT$ ${v.toLocaleString()}`,
          },
          {
            title: "點燈進度",
            render: (_: unknown, record: LanternWallDto) =>
              record.slotCount > 0 ? (
                <Tag color={record.claimedCount >= record.slotCount ? "red" : "green"}>
                  {record.claimedCount} / {record.slotCount}
                </Tag>
              ) : (
                <Typography.Text type="secondary">尚無燈位</Typography.Text>
              ),
          },
          {
            title: "累計收款",
            render: (_: unknown, record: LanternWallDto) => `NT$ ${record.totalAmount.toLocaleString()}`,
          },
          {
            title: "操作",
            render: (_: unknown, record: LanternWallDto) => (
              <Space>
                <Button size="small" onClick={() => setEditingWall(record)}>
                  編輯
                </Button>
                <Popconfirm
                  title="確定要刪除此燈牆嗎？"
                  description="燈牆底下所有燈位也會一併刪除；若已有信眾點燈，會再跟你確認一次"
                  okText="刪除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => deleteMutation.mutate({ id: record.id, force: false })}
                >
                  <Button danger size="small" loading={deleteMutation.isPending}>
                    刪除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {editingWall && <EditWallModal wall={editingWall} onClose={() => setEditingWall(null)} />}
    </Card>
  );
}

function CreateLanternWallSection({ templeId }: { templeId: string }) {
  const queryClient = useQueryClient();
  const [wallId, setWallId] = useState<string | undefined>();
  const [editingSlot, setEditingSlot] = useState<LanternSlotDto | null>(null);
  const [wallForm] = Form.useForm();
  const [pickerResetToken, setPickerResetToken] = useState(0);

  const wallsQuery = useQuery({ queryKey: ["walls", templeId], queryFn: () => listWalls(templeId) });
  const slotsQuery = useQuery({
    queryKey: ["wall-slots", wallId],
    queryFn: () => getWallSlots(wallId!),
    enabled: !!wallId,
  });

  const createWallMutation = useMutation({
    mutationFn: createWall,
    onSuccess: (newWall) => {
      queryClient.invalidateQueries({ queryKey: ["walls", templeId] });
      setWallId(newWall.id);
      wallForm.resetFields();
    },
  });

  const generateSlotsMutation = useMutation({
    mutationFn: (values: { prefix: string; positions: { row: number; column: number }[] }) =>
      generateSlots(wallId!, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wall-slots", wallId] });
      setPickerResetToken((t) => t + 1);
    },
  });

  const wall = wallsQuery.data?.find((w) => w.id === wallId);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title="新增燈牆">
        <Form
          form={wallForm}
          layout="vertical"
          initialValues={{ year: new Date().getFullYear() }}
          onFinish={(values) => createWallMutation.mutate({ ...values, templeId })}
        >
          <Form.Item label="燈牆名稱" name="name" rules={[{ required: true }]}>
            <Input placeholder="例如：大殿光明燈、太歲殿太歲燈" />
          </Form.Item>
          <Form.Item label="年度" name="year" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={2000} />
          </Form.Item>
          <Form.Item label="每盞燈價格" name="slotPrice" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="isTaisuiWall" valuePropName="checked" initialValue={false}>
            <Checkbox>太歲燈牆（點燈內容將固定鎖定為「太歲燈」，不開放選擇其他點燈內容）</Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={createWallMutation.isPending}>
            建立燈牆
          </Button>
        </Form>
      </Card>

      <Card title="新增燈位">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Typography.Text strong>燈牆：</Typography.Text>
            <Select
              style={{ width: 240 }}
              value={wallId}
              onChange={setWallId}
              placeholder="請先建立或選擇燈牆"
              options={(wallsQuery.data ?? []).map((w) => ({ value: w.id, label: `${w.name}（${w.year}年）` }))}
            />
            {wall && <Tag color="gold">每盞燈 NT$ {wall.slotPrice.toLocaleString()}</Tag>}
          </Space>

          {wallId && (
            <LanternSlotPicker
              key={pickerResetToken}
              submitting={generateSlotsMutation.isPending}
              errorMessage={
                generateSlotsMutation.isError
                  ? ((generateSlotsMutation.error as any)?.response?.data?.message ?? "新增燈位失敗，請重試")
                  : undefined
              }
              onSubmit={(values) => generateSlotsMutation.mutate(values)}
            />
          )}
        </Space>
      </Card>

      {wallId && (
        <Card title={`燈位圖：${wall?.name ?? ""}`} loading={slotsQuery.isLoading}>
          {(slotsQuery.data ?? []).some((s) => s.claim) && (
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
              點擊已點亮的燈位可修改姓名／祈願內容
            </Typography.Text>
          )}
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
                      .map((slot) => (
                        <div
                          key={slot.id}
                          className={`slot-cell ${slot.status === LanternSlotStatus.CLAIMED ? "claimed" : "empty"}`}
                          title={slot.claim ? `${slot.claim.memberName}（點擊可編輯）` : "空燈位"}
                          style={{ cursor: slot.claim ? "pointer" : "default" }}
                          onClick={() => slot.claim && setEditingSlot(slot)}
                        >
                          <div>{slot.code}</div>
                          {slot.claim && <div style={{ fontSize: 12 }}>{slot.claim.memberName}</div>}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
          </Space>
          {(slotsQuery.data ?? []).length === 0 && (
            <Typography.Text type="secondary">此燈牆尚無燈位，請於上方設定數量與排列</Typography.Text>
          )}
        </Card>
      )}
      {editingSlot && (
        <EditClaimModal
          slot={editingSlot}
          wallName={wall?.name}
          wallIsTaisuiWall={wall?.isTaisuiWall}
          onClose={() => setEditingSlot(null)}
        />
      )}
      <LanternWallListCard
        templeId={templeId}
        selectedWallId={wallId}
        onWallDeleted={(deletedId) => {
          if (deletedId === wallId) setWallId(undefined);
        }}
      />
    </Space>
  );
}

export function CreateActivityPage() {
  const [activityType, setActivityType] = useState<ActivityType>("ceremony");
  const { activeTempleId } = useTemple();
  const templeId = activeTempleId === ALL_TEMPLES ? undefined : activeTempleId;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        建立活動
      </Typography.Title>

      <Card>
        <Space direction="vertical">
          <Typography.Text strong>選擇要建立的活動類型：</Typography.Text>
          <Radio.Group
            options={activityTypeOptions}
            optionType="button"
            value={activityType}
            onChange={(e) => setActivityType(e.target.value)}
          />
        </Space>
      </Card>

      {!templeId ? (
        <Alert type="info" showIcon message="請先在上方選擇一間廟宇，才能建立該廟的活動" />
      ) : (
        <>
          {activityType === "ceremony" && (
            <>
              <CreateCeremonyForm templeId={templeId} />
              <CeremonyListCard templeId={templeId} />
            </>
          )}
          {activityType === "lanternWall" && <CreateLanternWallSection templeId={templeId} />}
        </>
      )}
    </Space>
  );
}
