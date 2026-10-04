import { useState } from "react";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Calendar,
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
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { CalendarProps } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import {
  CeremonyFeeMode,
  CeremonyReportDto,
  FinancialReportDto,
  CeremonyDto,
  IncomeDetailDto,
  LedgerEntryCategory,
  LedgerEntryDto,
  LedgerEntryStatus,
  LedgerEntryType,
  PETTY_CASH_CATEGORY_LABEL,
  PETTY_CASH_LEGACY_CATEGORY_LABEL,
  UserRole,
} from "@tms/shared";
import {
  batchApproveLedgerEntries,
  confirmAudit,
  createLedgerEntry,
  getAnnualReport,
  getAuditCalendar,
  getDailyReport,
  getMonthlyReport,
  getPettyCashBalance,
  getRangeReport,
  listLedgerEntries,
  resetPettyCashBalance,
  reviewLedgerEntry,
} from "../api/finance";
import { getCeremonyReport, listCeremonies } from "../api/ceremony";
import { deleteReceipt } from "../api/lantern";
import { openPrintWindow } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ALL_TEMPLES, useTemple } from "../context/TempleContext";
import { ExportButtons } from "../components/ExportButtons";
import { exportRowsToExcel } from "../utils/export";

const categoryLabel: Record<LedgerEntryCategory, string> = {
  [LedgerEntryCategory.PAPER_MONEY_SALES]: "金紙販售",
  [LedgerEntryCategory.EXTERNAL_DONATION]: "外部捐款",
  [LedgerEntryCategory.OTHER_INCOME]: "其他收入",
  [LedgerEntryCategory.UTILITIES]: "水電",
  [LedgerEntryCategory.RITUAL_MASTER_FEE]: "法師車馬費",
  [LedgerEntryCategory.REPAIR]: "修繕費",
  [LedgerEntryCategory.OFFERING_SUPPLIES]: "祭品採購",
  [LedgerEntryCategory.OTHER_EXPENSE]: "其他支出",
  // 已停用，不再開放選用；保留此對應僅供顯示改版前用舊分類建立的歷史紀錄
  [LedgerEntryCategory.PETTY_CASH]: PETTY_CASH_LEGACY_CATEGORY_LABEL,
  [LedgerEntryCategory.SALARY]: "薪資支出",
  [LedgerEntryCategory.PETTY_CASH_REPLENISHMENT]: PETTY_CASH_CATEGORY_LABEL,
};

/** 撥補零用金的預設金額，選擇「零用金撥補」分類時自動帶入（仍可手動修改） */
const PETTY_CASH_TOPUP_AMOUNT = 20000;

/** 分類已改為可自由輸入的文字，非固定清單中的值（例如使用者自訂項目）就直接顯示原始文字 */
const resolveCategoryLabel = (c: string) => categoryLabel[c as LedgerEntryCategory] ?? c;

const incomeCategories = [
  LedgerEntryCategory.PAPER_MONEY_SALES,
  LedgerEntryCategory.EXTERNAL_DONATION,
  LedgerEntryCategory.OTHER_INCOME,
];
const expenseCategories = [
  LedgerEntryCategory.UTILITIES,
  LedgerEntryCategory.RITUAL_MASTER_FEE,
  LedgerEntryCategory.SALARY,
  LedgerEntryCategory.REPAIR,
  LedgerEntryCategory.OFFERING_SUPPLIES,
  LedgerEntryCategory.OTHER_EXPENSE,
  LedgerEntryCategory.PETTY_CASH_REPLENISHMENT,
];

function LedgerEntryForm({ templeId }: { templeId: string }) {
  const { user } = useAuth();
  const canReview = user?.role === UserRole.FINANCE || user?.role === UserRole.DIRECTOR;
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const entryType = Form.useWatch("type", form) ?? LedgerEntryType.INCOME;
  const category = Form.useWatch("category", form);
  const isPettyCashTopUp = category === categoryLabel[LedgerEntryCategory.PETTY_CASH_REPLENISHMENT];
  const includeInCeremony = Form.useWatch("includeInCeremony", form);

  const pettyCashQuery = useQuery({
    queryKey: ["petty-cash-balance", templeId],
    queryFn: () => getPettyCashBalance(templeId),
  });
  const ceremoniesQuery = useQuery({
    queryKey: ["ceremonies", templeId, "active"],
    queryFn: () => listCeremonies(templeId, true),
    enabled: !!templeId,
  });

  const mutation = useMutation({
    mutationFn: createLedgerEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ledger-entries"] });
      queryClient.invalidateQueries({ queryKey: ["petty-cash-balance"] });
      queryClient.invalidateQueries({ queryKey: ["ceremony-report"] });
      form.resetFields();
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetPettyCashBalance(templeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["petty-cash-balance"] });
    },
  });

  return (
    <Card title="新增流水帳項目">
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: LedgerEntryType.INCOME, occurredAt: dayjs(), isPettyCash: false }}
        onFinish={(values) =>
          mutation.mutate({
            templeId,
            type: values.type,
            category: values.category,
            amount: values.amount,
            description: values.description,
            occurredAt: (values.occurredAt as Dayjs).format("YYYY-MM-DD"),
            isPettyCash: values.type === LedgerEntryType.EXPENSE && !isPettyCashTopUp ? !!values.isPettyCash : false,
            ceremonyId:
              values.type === LedgerEntryType.EXPENSE && values.includeInCeremony ? values.ceremonyId : undefined,
          })
        }
      >
        <Form.Item label="收支類型" name="type">
          <Radio.Group
            onChange={() => {
              form.setFieldValue("category", undefined);
              form.setFieldValue("isPettyCash", false);
              form.setFieldValue("includeInCeremony", false);
              form.setFieldValue("ceremonyId", undefined);
            }}
          >
            <Radio.Button value={LedgerEntryType.INCOME}>收入</Radio.Button>
            <Radio.Button value={LedgerEntryType.EXPENSE}>支出</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="項目分類" name="category" rules={[{ required: true }]}>
          <AutoComplete
            options={(entryType === LedgerEntryType.INCOME ? incomeCategories : expenseCategories).map((c) => ({
              value: categoryLabel[c],
            }))}
            placeholder="選擇既有分類，或直接輸入自訂項目名稱"
            filterOption={(inputValue, option) =>
              (option?.value ?? "").toLowerCase().includes(inputValue.toLowerCase())
            }
            onSelect={(value) => {
              if (value === categoryLabel[LedgerEntryCategory.PETTY_CASH_REPLENISHMENT]) {
                form.setFieldValue("amount", PETTY_CASH_TOPUP_AMOUNT);
                form.setFieldValue("isPettyCash", false);
              }
            }}
          />
        </Form.Item>
        <Form.Item label="日期" name="occurredAt" rules={[{ required: true }]}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="金額" name="amount" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        {entryType === LedgerEntryType.EXPENSE && (
          <Form.Item label=" " colon={false}>
            <Space align="center">
              <Form.Item name="isPettyCash" valuePropName="checked" noStyle>
                <Checkbox disabled={isPettyCashTopUp}>從零用金支出（不計入總帳）</Checkbox>
              </Form.Item>
              <Typography.Text type="secondary">
                剩餘零用金：NT$ {(pettyCashQuery.data?.balance ?? 0).toLocaleString()}
              </Typography.Text>
              {canReview && (
                <Popconfirm
                  title="確定要將剩餘零用金歸零嗎？"
                  description="只會重設計算基準點，不會刪除任何流水帳紀錄，之後會從下一筆零用金撥補重新起算"
                  onConfirm={() => resetMutation.mutate()}
                  okText="確定歸零"
                  cancelText="取消"
                >
                  <Button size="small" loading={resetMutation.isPending}>
                    重新歸零
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </Form.Item>
        )}
        {entryType === LedgerEntryType.EXPENSE && (
          <Form.Item label=" " colon={false}>
            <Space direction="vertical" style={{ width: "100%" }} size="small">
              <Form.Item name="includeInCeremony" valuePropName="checked" noStyle>
                <Checkbox
                  onChange={(e) => {
                    if (!e.target.checked) form.setFieldValue("ceremonyId", undefined);
                  }}
                >
                  列入活動計算（此筆支出仍照常計入總帳，額外再統計進選擇的活動）
                </Checkbox>
              </Form.Item>
              {includeInCeremony && (
                <Form.Item
                  name="ceremonyId"
                  rules={[{ required: true, message: "請選擇活動" }]}
                  style={{ marginBottom: 0, maxWidth: 320 }}
                >
                  <Select
                    placeholder="選擇活動"
                    loading={ceremoniesQuery.isLoading}
                    options={(ceremoniesQuery.data ?? []).map((c: CeremonyDto) => ({
                      value: c.id,
                      label: `${c.name}（${c.date}）`,
                    }))}
                  />
                </Form.Item>
              )}
            </Space>
          </Form.Item>
        )}
        <Form.Item label="說明" name="description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={mutation.isPending}>
          送出（待財務審核）
        </Button>
      </Form>
    </Card>
  );
}

function PendingReview({ templeId }: { templeId?: string }) {
  const queryClient = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const pendingQuery = useQuery({
    queryKey: ["ledger-entries", LedgerEntryStatus.PENDING, templeId],
    queryFn: () => listLedgerEntries(LedgerEntryStatus.PENDING, templeId),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: "APPROVE" | "REJECT"; reason?: string }) =>
      reviewLedgerEntry(id, { action, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ledger-entries"] });
      setRejectTarget(null);
      setReason("");
    },
  });

  return (
    <Card title="待審核流水帳">
      <Table
        rowKey="id"
        loading={pendingQuery.isLoading}
        dataSource={pendingQuery.data ?? []}
        pagination={false}
        columns={[
          {
            title: "類型",
            dataIndex: "type",
            render: (t: LedgerEntryType) => (
              <Tag color={t === LedgerEntryType.INCOME ? "green" : "red"}>
                {t === LedgerEntryType.INCOME ? "收入" : "支出"}
              </Tag>
            ),
          },
          {
            title: "分類",
            dataIndex: "category",
            render: (c: string, record: LedgerEntryDto) => (
              <Space size={4}>
                {resolveCategoryLabel(c)}
                {record.isPettyCash && <Tag color="gold">零用金支出</Tag>}
                {record.ceremonyId && <Tag color="blue">列入活動計算</Tag>}
              </Space>
            ),
          },
          { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
          { title: "日期", dataIndex: "occurredAt" },
          { title: "說明", dataIndex: "description" },
          { title: "登錄人", dataIndex: "createdByName" },
          {
            title: "操作",
            render: (_, record) => (
              <Space>
                <Button
                  size="small"
                  type="primary"
                  loading={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate({ id: record.id, action: "APPROVE" })}
                >
                  核准
                </Button>
                <Button size="small" danger onClick={() => setRejectTarget(record.id)}>
                  駁回
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="駁回原因"
        open={!!rejectTarget}
        onCancel={() => setRejectTarget(null)}
        onOk={() => rejectTarget && reviewMutation.mutate({ id: rejectTarget, action: "REJECT", reason })}
        okButtonProps={{ danger: true, disabled: reason.trim().length < 2 }}
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="請說明駁回原因" />
      </Modal>
    </Card>
  );
}

const datesInRange = (from: Dayjs, to: Dayjs): string[] => {
  const dates: string[] = [];
  let cur = from.startOf("day");
  const end = to.startOf("day");
  while (!cur.isAfter(end, "day")) {
    dates.push(cur.format("YYYY-MM-DD"));
    cur = cur.add(1, "day");
  }
  return dates;
};

/**
 * 審核日誌：以日曆顯示每天的審核狀態。審核內容涵蓋當天「所有」收入來源——
 * 已開立收據的點燈/捐款/法會報名/送禮（已完成、僅供核對，無法變更），
 * 加上手動登錄的流水帳項目（可逐筆勾選是否入帳／直接駁回）。
 * 可點選單日或用區間選擇器選一段期間，開啟確認頁核對無誤後按「確認審核並入帳」，
 * 該期間內每一天都會標記為已審核（綠色），日曆上未審核但有收入的日子顯示橘色「待審核」。
 * 與「待審核流水帳」表格的單筆核准/駁回並存，此處僅提供整天彙總審核的另一種入口。
 */
function AuditCalendar({ templeId }: { templeId?: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [panelMonth, setPanelMonth] = useState(dayjs());
  const [auditRange, setAuditRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const monthStart = panelMonth.startOf("month").format("YYYY-MM-DD");
  const monthEnd = panelMonth.endOf("month").format("YYYY-MM-DD");
  const calendarQuery = useQuery({
    queryKey: ["ledger-audit-calendar", monthStart, monthEnd, templeId],
    queryFn: () => getAuditCalendar(monthStart, monthEnd, templeId!),
    enabled: !!templeId,
  });
  const summaryByDate = new Map((calendarQuery.data ?? []).map((s) => [s.date, s]));

  const rangeFrom = auditRange?.[0]?.format("YYYY-MM-DD");
  const rangeTo = auditRange?.[1]?.format("YYYY-MM-DD");
  const entriesQuery = useQuery({
    queryKey: ["ledger-entries", LedgerEntryStatus.PENDING, templeId, rangeFrom, rangeTo],
    queryFn: () => listLedgerEntries(LedgerEntryStatus.PENDING, templeId, rangeFrom, rangeTo),
    enabled: confirmOpen && !!templeId && !!rangeFrom && !!rangeTo,
  });
  const receiptReportQuery = useQuery({
    queryKey: ["ledger-audit-receipts", templeId, rangeFrom, rangeTo],
    queryFn: () => getRangeReport(rangeFrom!, rangeTo!, templeId),
    enabled: confirmOpen && !!templeId && !!rangeFrom && !!rangeTo,
  });

  const invalidateAfterReview = () => {
    queryClient.invalidateQueries({ queryKey: ["ledger-entries"] });
    queryClient.invalidateQueries({ queryKey: ["ledger-audit-calendar"] });
    queryClient.invalidateQueries({ queryKey: ["report-daily"] });
    queryClient.invalidateQueries({ queryKey: ["report-monthly"] });
    queryClient.invalidateQueries({ queryKey: ["report-range"] });
    queryClient.invalidateQueries({ queryKey: ["report-annual"] });
  };

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      reviewLedgerEntry(id, { action: "REJECT", reason }),
    onSuccess: () => {
      invalidateAfterReview();
      setRejectTarget(null);
      setReason("");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (includedEntries.length > 0) {
        await batchApproveLedgerEntries(includedEntries.map((e) => e.id));
      }
      const dates = auditRange ? datesInRange(auditRange[0], auditRange[1]) : [];
      return confirmAudit(templeId!, dates);
    },
    onSuccess: (res) => {
      invalidateAfterReview();
      message.success(`已完成 ${res.auditedDates.length} 天的審核`);
      setConfirmOpen(false);
      setExcludedIds(new Set());
    },
  });

  const openConfirm = (range: [Dayjs, Dayjs]) => {
    setAuditRange(range);
    setExcludedIds(new Set());
    setConfirmOpen(true);
  };

  // 審核要逐筆核對，依時間先後（早到晚）排序比較符合「照順序檢查一遍」的使用情境
  const sortedIncomeDetails = [...(receiptReportQuery.data?.incomeDetails ?? [])].sort(
    (a, b) => dayjs(a.occurredAt).valueOf() - dayjs(b.occurredAt).valueOf(),
  );
  const entries = [...(entriesQuery.data ?? [])].sort(
    (a, b) => dayjs(a.occurredAt).valueOf() - dayjs(b.occurredAt).valueOf(),
  );
  const includedEntries = entries.filter((e) => !excludedIds.has(e.id));
  // 「從零用金支出」的項目不計入總帳（避免與零用金撥補重複計算），故排除在合計金額之外
  const includedLedgerTotal = includedEntries.reduce(
    (sum, e) => sum + (e.isPettyCash ? 0 : e.type === LedgerEntryType.INCOME ? e.amount : -e.amount),
    0,
  );
  const receiptIncomeTotal = receiptReportQuery.data?.lanternAndDonationIncome ?? 0;
  const grandTotal = receiptIncomeTotal + includedLedgerTotal;
  const hasAnythingToReview = entries.length > 0 || receiptIncomeTotal > 0;

  const cellRender: CalendarProps<Dayjs>["cellRender"] = (current, info) => {
    if (info.type !== "date") return info.originNode;
    const summary = summaryByDate.get(current.format("YYYY-MM-DD"));
    if (!summary) return null;
    if (summary.audited) {
      return (
        <div style={{ textAlign: "center" }}>
          <Tag color="green" style={{ marginInlineEnd: 0, fontSize: 11 }}>
            已審核
          </Tag>
        </div>
      );
    }
    const hasActivity = summary.pendingCount > 0 || summary.approvedCount > 0 || summary.rejectedCount > 0 || summary.hasReceiptIncome;
    if (!hasActivity) return null;
    return (
      <div style={{ textAlign: "center" }}>
        <Tag color="orange" style={{ marginInlineEnd: 0, fontSize: 11 }}>
          待審核
        </Tag>
      </div>
    );
  };

  if (!templeId) {
    return (
      <Card title="審核日誌">
        <Alert type="info" showIcon message="請先在上方選擇一間廟宇，才能查看與進行該廟的每日審核" />
      </Card>
    );
  }

  return (
    <Card
      title="審核日誌"
      extra={
        <Space>
          <DatePicker.RangePicker
            value={auditRange}
            onChange={(v) => setAuditRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
          />
          <Button type="primary" disabled={!auditRange} onClick={() => auditRange && openConfirm(auditRange)}>
            產生確認清單
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="審核內容包含當天所有收入：已開立收據的點燈／捐款／法會報名／送禮，以及手動登錄的流水帳項目。點選日曆上的某一天可直接以「當天」為審核區間；也可用右上角選擇一段期間，再按「產生確認清單」進入審核"
      />
      <Calendar
        fullscreen={false}
        value={panelMonth}
        onPanelChange={(v) => setPanelMonth(v)}
        onSelect={(date, { source }) => {
          setPanelMonth(date);
          if (source === "date") openConfirm([date, date]);
        }}
        cellRender={cellRender}
      />

      <Modal
        title={
          auditRange
            ? `審核確認 ${auditRange[0].format("YYYY-MM-DD")}${
                auditRange[0].isSame(auditRange[1], "day") ? "" : ` ~ ${auditRange[1].format("YYYY-MM-DD")}`
              }`
            : "審核確認"
        }
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        width={1200}
        footer={[
          <Button key="cancel" onClick={() => setConfirmOpen(false)}>
            取消
          </Button>,
          <Button
            key="submit"
            type="primary"
            disabled={!hasAnythingToReview || entriesQuery.isLoading || receiptReportQuery.isLoading}
            loading={confirmMutation.isPending}
            onClick={() => confirmMutation.mutate()}
          >
            確認審核並入帳（合計 NT$ {grandTotal.toLocaleString()}）
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="請確認以下當天所有收入項目與金額都正確無誤後再按「確認審核並入帳」；一經審核即無法再修改或刪除"
        />

        <Typography.Title level={5} style={{ marginTop: 0 }}>
          已開立收據的收入（唯讀，僅供核對）
        </Typography.Title>
        <Table
          size="small"
          rowKey={(d: IncomeDetailDto) => `${d.receiptNo}-${d.label}-${d.amount}`}
          loading={receiptReportQuery.isLoading}
          dataSource={sortedIncomeDetails.map((d, i) => ({ ...d, seq: i + 1 }))}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            hideOnSinglePage: true,
          }}
          locale={{ emptyText: "本期間沒有已開立收據的收入" }}
          columns={[
            { title: "編號", dataIndex: "seq", width: 60 },
            {
              title: "時間",
              dataIndex: "occurredAt",
              render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
            },
            { title: "項目", dataIndex: "label" },
            { title: "捐款人／參加者", dataIndex: "payerName", render: (v: string) => v || "（未留姓名）" },
            { title: "備註", dataIndex: "note", render: (v?: string) => v || "-" },
            { title: "收據編號", dataIndex: "receiptNo" },
            { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}>
                收據收入合計
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1}>NT$ {receiptIncomeTotal.toLocaleString()}</Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />

        <Typography.Title level={5}>手動登錄流水帳項目（可勾選是否入帳／可駁回）</Typography.Title>
        <Table
          size="small"
          rowKey="id"
          loading={entriesQuery.isLoading}
          dataSource={entries}
          pagination={false}
          locale={{ emptyText: "本期間沒有待審核的流水帳項目" }}
          columns={[
            {
              title: "入帳",
              width: 56,
              render: (_, record: LedgerEntryDto) => (
                <Checkbox
                  checked={!excludedIds.has(record.id)}
                  onChange={(e) =>
                    setExcludedIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.delete(record.id);
                      else next.add(record.id);
                      return next;
                    })
                  }
                />
              ),
            },
            {
              title: "類型",
              dataIndex: "type",
              render: (t: LedgerEntryType) => (
                <Tag color={t === LedgerEntryType.INCOME ? "green" : "red"}>
                  {t === LedgerEntryType.INCOME ? "收入" : "支出"}
                </Tag>
              ),
            },
            {
              title: "分類",
              dataIndex: "category",
              render: (c: string, record: LedgerEntryDto) => (
                <Space size={4}>
                  {resolveCategoryLabel(c)}
                  {record.isPettyCash && <Tag color="gold">零用金支出</Tag>}
                </Space>
              ),
            },
            { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
            { title: "日期", dataIndex: "occurredAt" },
            { title: "說明", dataIndex: "description" },
            { title: "登錄人", dataIndex: "createdByName" },
            {
              title: "操作",
              render: (_, record: LedgerEntryDto) => (
                <Button size="small" danger onClick={() => setRejectTarget(record.id)}>
                  駁回
                </Button>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title="駁回原因"
        open={!!rejectTarget}
        onCancel={() => setRejectTarget(null)}
        onOk={() => rejectTarget && rejectMutation.mutate({ id: rejectTarget, reason })}
        okButtonProps={{ danger: true, disabled: reason.trim().length < 2, loading: rejectMutation.isPending }}
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="請說明駁回原因" />
      </Modal>
    </Card>
  );
}

/**
 * 最上方固定先列出「總收入／總支出／淨額」三行加總（daily 報表沿用原本的 topSummaryLabel 當總收入的標籤），
 * 讓每一份匯出的財務報表一開始就看得到全部金額的加總，不用捲到最下面自己加。
 * 接著依「大項目」（點燈／活動報名／各捐款類別、手動登錄各分類、支出各分類）分段，
 * 每個大項目先列出小計，同類型的細項（逐筆收據明細，含日期）緊接著列在其下方，不與其他類別交錯。
 * 大項目小計/分類彙總行沒有單一對應日期，日期欄位留空。
 * 每筆明細前面另有獨立的「序號」欄，每個大項目各自從 1 開始重新編號（不同項目不連號），
 * 方便快速核對「共 N 筆」跟實際明細筆數是否一致。
 */
function reportToRows(
  report: FinancialReportDto,
  periodLabel: string,
  topSummaryLabel?: string,
): (string | number)[][] {
  const rows: (string | number)[][] = [["", "報表期間", periodLabel, ""]];
  rows.push(["", topSummaryLabel ?? "總收入", "", report.totalIncome]);
  rows.push(["", "總支出", "", report.totalExpense]);
  rows.push(["", "淨額", "", report.netAmount]);

  report.lanternIncomeByCategory.forEach((c) => {
    rows.push(["", "", `收入 - ${c.label}`, c.amount]);
    const details = report.incomeDetails.filter((d) => d.label === c.label);
    details.forEach((d, i) =>
      rows.push([
        i + 1,
        dayjs(d.occurredAt).format("YYYY-MM-DD HH:mm"),
        `${d.payerName || "（未留姓名）"}（${d.receiptNo}）${d.note ? `　${d.note}` : ""}`,
        d.amount,
      ]),
    );
    rows.push(["", "", `共 ${details.length} 筆`, ""]);
  });
  report.ledgerIncomeByCategory.forEach((c) =>
    rows.push(["", "", `收入 - ${resolveCategoryLabel(c.category)}`, c.amount]),
  );
  report.expenseByCategory.forEach((c) =>
    rows.push(["", "", `支出 - ${resolveCategoryLabel(c.category)}`, c.amount]),
  );

  if (report.pettyCashExpenseDetails.length > 0) {
    rows.push(["", "", "零用金支出（不計入總支出／淨額）", report.pettyCashExpenseTotal]);
    report.pettyCashExpenseDetails.forEach((e, i) =>
      rows.push([i + 1, e.occurredAt, `${resolveCategoryLabel(e.category)}${e.description ? `　${e.description}` : ""}`, e.amount]),
    );
    rows.push(["", "", `共 ${report.pettyCashExpenseDetails.length} 筆`, ""]);
  }

  return rows;
}

function ReportContent({
  report,
  periodLabel,
  fileLabel,
  active,
  topSummaryLabel,
}: {
  report?: FinancialReportDto;
  periodLabel: string;
  fileLabel: string;
  active: boolean;
  /** 有提供時會在報表最上方額外顯示一行總計金額（例如每日結帳的「今日總計金額」） */
  topSummaryLabel?: string;
}) {
  if (!report) return null;

  const handleExportExcel = () =>
    exportRowsToExcel(
      `財務報表_${fileLabel}.xlsx`,
      periodLabel,
      ["序號", "日期", "項目", "金額"],
      reportToRows(report, periodLabel, topSummaryLabel),
    );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <ExportButtons onExportExcel={handleExportExcel} shortcutEnabled={active} />
      <div style={{ background: "#fff", padding: 8 }}>
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          {topSummaryLabel && (
            <Statistic
              title={topSummaryLabel}
              value={report.totalIncome}
              prefix="NT$"
              valueStyle={{ fontSize: 32, fontWeight: "bold", color: "#a8071a" }}
            />
          )}
          <Space size="large" wrap>
            <Statistic title="總收入" value={report.totalIncome} prefix="NT$" />
            <Statistic title="總支出" value={report.totalExpense} prefix="NT$" />
            <Statistic
              title="淨額"
              value={report.netAmount}
              prefix="NT$"
              valueStyle={{ color: report.netAmount >= 0 ? "#1a5c26" : "#a8071a" }}
            />
            <Statistic title="待審核筆數" value={report.pendingEntryCount} />
          </Space>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="捐款/點燈/活動收入（系統自動）">
              NT$ {report.lanternAndDonationIncome.toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="手動登錄收入合計">
              NT$ {report.ledgerIncome.toLocaleString()}
            </Descriptions.Item>
          </Descriptions>
          <Table
            size="small"
            rowKey="label"
            pagination={false}
            title={() => "收入分類總計（系統自動：點燈／捐款／活動）"}
            dataSource={report.lanternIncomeByCategory}
            columns={[
              { title: "項目", dataIndex: "label" },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
            ]}
          />
          <Table
            size="small"
            rowKey={(d: IncomeDetailDto) => `${d.receiptNo}-${d.label}-${d.amount}`}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            title={() => "收入逐筆明細（含捐款人／參加者姓名）"}
            dataSource={report.incomeDetails}
            columns={[
              {
                title: "時間",
                dataIndex: "occurredAt",
                render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
              },
              { title: "項目", dataIndex: "label" },
              { title: "捐款人／參加者", dataIndex: "payerName", render: (v: string) => v || "（未留姓名）" },
              { title: "備註", dataIndex: "note", render: (v?: string) => v || "-" },
              { title: "收據編號", dataIndex: "receiptNo" },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
            ]}
          />
          <Table
            size="small"
            rowKey="category"
            pagination={false}
            title={() => "收入明細（手動登錄）"}
            dataSource={report.ledgerIncomeByCategory}
            columns={[
              { title: "分類", dataIndex: "category", render: (c: string) => resolveCategoryLabel(c) },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
            ]}
          />
          <Table
            size="small"
            rowKey="category"
            pagination={false}
            title={() => "支出明細"}
            dataSource={report.expenseByCategory}
            columns={[
              { title: "分類", dataIndex: "category", render: (c: string) => resolveCategoryLabel(c) },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
            ]}
          />
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            title={() => (
              <Space>
                <span>零用金支出明細</span>
                <Tag color="gold">不計入總支出／淨額，僅供查看</Tag>
                <span>合計 NT$ {report.pettyCashExpenseTotal.toLocaleString()}</span>
              </Space>
            )}
            locale={{ emptyText: "本期間沒有從零用金支出的項目" }}
            dataSource={report.pettyCashExpenseDetails}
            columns={[
              { title: "日期", dataIndex: "occurredAt" },
              { title: "分類", dataIndex: "category", render: (c: string) => resolveCategoryLabel(c) },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
              { title: "說明", dataIndex: "description", render: (v: string | null) => v || "-" },
              { title: "登錄人", dataIndex: "createdByName" },
            ]}
          />
        </Space>
      </div>
    </Space>
  );
}

function CeremonyReportContent({ report, active }: { report?: CeremonyReportDto; active: boolean }) {
  const { user } = useAuth();
  const canDeleteReceipt = user?.role === UserRole.DIRECTOR;
  const queryClient = useQueryClient();
  const deleteReceiptMutation = useMutation({
    mutationFn: (receiptId: string) => deleteReceipt(receiptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceremony-report"] });
      queryClient.invalidateQueries({ queryKey: ["ceremonies"] });
    },
  });

  if (!report) return null;

  const { ceremony, totalAmount, registrationCount, registrations, donationTotal, donations, expenseTotal, expenses } =
    report;
  const headers = ["參加者", "金額", "座位", "報名時間"];
  const rows: (string | number)[][] = [
    ["報名費總額", totalAmount, "", ""],
    ...registrations.map((r) => [
      r.participantName || "（未留姓名）",
      r.amount,
      r.seatNumber ?? "",
      dayjs(r.createdAt).format("YYYY-MM-DD HH:mm"),
    ]),
  ];
  const handleExportExcel = () => exportRowsToExcel(`活動查詢_${ceremony.name}.xlsx`, ceremony.name, headers, rows);
  const handleExportDonationExcel = () =>
    exportRowsToExcel(
      `活動捐款_${ceremony.name}.xlsx`,
      ceremony.name,
      ["捐款人", "金額", "備註", "時間"],
      [
        ["捐款總額", donationTotal, "", ""],
        ...donations.map((d) => [
          d.payerName || "（未留姓名）",
          d.amount,
          d.note ?? "",
          dayjs(d.createdAt).format("YYYY-MM-DD HH:mm"),
        ]),
      ],
    );
  const handleExportExpenseExcel = () =>
    exportRowsToExcel(
      `活動支出_${ceremony.name}.xlsx`,
      ceremony.name,
      ["分類", "金額", "說明", "日期"],
      [
        ["支出總額", expenseTotal, "", ""],
        ...expenses.map((e) => [resolveCategoryLabel(e.category), e.amount, e.description ?? "", e.occurredAt]),
      ],
    );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <ExportButtons onExportExcel={handleExportExcel} shortcutEnabled={active} />
      <div style={{ background: "#fff", padding: 8 }}>
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <Descriptions bordered size="small" column={2} title={ceremony.name}>
            <Descriptions.Item label="日期">{ceremony.date}</Descriptions.Item>
            <Descriptions.Item label="收費方式">
              {ceremony.feeMode === CeremonyFeeMode.FIXED_AMOUNT
                ? `固定金額 NT$${ceremony.fixedAmount}`
                : "隨喜"}
            </Descriptions.Item>
            {ceremony.totalSeats != null && (
              <Descriptions.Item label="座位" span={2}>
                {ceremony.seatsAssigned} / {ceremony.totalSeats}（{ceremony.tableCount} 桌 ×{" "}
                {ceremony.seatsPerTable} 人）
              </Descriptions.Item>
            )}
            {ceremony.description && (
              <Descriptions.Item label="說明" span={2}>
                {ceremony.description}
              </Descriptions.Item>
            )}
          </Descriptions>
          <Space size="large" wrap>
            <Statistic title="報名費總額" value={totalAmount} prefix="NT$" />
            <Statistic title="報名筆數" value={registrationCount} />
            <Statistic title="活動本身的捐款" value={donationTotal} prefix="NT$" valueStyle={{ color: "#a8071a" }} />
            <Statistic title="列入活動計算的支出" value={expenseTotal} prefix="NT$" valueStyle={{ color: "#1a5c26" }} />
          </Space>
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            title={() => "報名明細"}
            dataSource={registrations}
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
          <Table
            size="small"
            rowKey={(d) => `${d.payerName}-${d.amount}-${d.createdAt}`}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            title={() => (
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <span>活動本身的捐款明細（不計入一般捐款統計）</span>
                {donations.length > 0 && (
                  <Button size="small" onClick={handleExportDonationExcel}>
                    匯出 Excel
                  </Button>
                )}
              </Space>
            )}
            dataSource={donations}
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
          <Table
            size="small"
            rowKey={(e) => `${e.category}-${e.amount}-${e.occurredAt}`}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            title={() => (
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <span>列入活動計算的支出明細（仍計入財務報表總支出，此處僅為額外統計）</span>
                {expenses.length > 0 && (
                  <Button size="small" onClick={handleExportExpenseExcel}>
                    匯出 Excel
                  </Button>
                )}
              </Space>
            )}
            dataSource={expenses}
            locale={{ emptyText: "此活動尚無列入計算的支出" }}
            columns={[
              { title: "分類", dataIndex: "category", render: (c: string) => resolveCategoryLabel(c) },
              { title: "金額", dataIndex: "amount", render: (v: number) => `NT$ ${v.toLocaleString()}` },
              { title: "說明", dataIndex: "description", render: (v: string | null) => v ?? "-" },
              { title: "日期", dataIndex: "occurredAt" },
            ]}
          />
        </Space>
      </div>
    </Space>
  );
}

/** 供報名櫃檯人員使用：只看得到每日結帳，不含每月/年度/區間/活動查詢與流水帳審核 */
function DailyReportOnly({ templeId }: { templeId?: string }) {
  const [date, setDate] = useState(dayjs());
  const dailyQuery = useQuery({
    queryKey: ["report-daily", date.format("YYYY-MM-DD"), templeId],
    queryFn: () => getDailyReport(date.format("YYYY-MM-DD"), templeId),
  });

  return (
    <Card
      title={`每日結帳${templeId ? "" : "（全部廟宇合併）"}`}
      extra={<DatePicker value={date} onChange={(v) => v && setDate(v)} />}
    >
      <ReportContent
        report={dailyQuery.data}
        periodLabel={`每日結帳 ${date.format("YYYY-MM-DD")}`}
        fileLabel={`daily_${date.format("YYYY-MM-DD")}`}
        active
        topSummaryLabel="今日總計金額"
      />
    </Card>
  );
}

function ReportPanel({ templeId }: { templeId?: string }) {
  const [date, setDate] = useState(dayjs());
  const [rangeDates, setRangeDates] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedCeremonyId, setSelectedCeremonyId] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState("daily");

  const dailyQuery = useQuery({
    queryKey: ["report-daily", date.format("YYYY-MM-DD"), templeId],
    queryFn: () => getDailyReport(date.format("YYYY-MM-DD"), templeId),
  });
  const monthlyQuery = useQuery({
    queryKey: ["report-monthly", date.format("YYYY-MM"), templeId],
    queryFn: () => getMonthlyReport(date.year(), date.month() + 1, templeId),
  });
  const annualQuery = useQuery({
    queryKey: ["report-annual", date.year(), templeId],
    queryFn: () => getAnnualReport(date.year(), templeId),
  });

  const rangeStart = rangeDates?.[0]?.format("YYYY-MM-DD");
  const rangeEnd = rangeDates?.[1]?.format("YYYY-MM-DD");
  const rangeQuery = useQuery({
    queryKey: ["report-range", rangeStart, rangeEnd, templeId],
    queryFn: () => getRangeReport(rangeStart!, rangeEnd!, templeId),
    enabled: !!rangeStart && !!rangeEnd,
  });

  const ceremoniesQuery = useQuery({
    queryKey: ["ceremonies", templeId],
    queryFn: () => listCeremonies(templeId),
    enabled: activeTab === "activity",
  });
  const ceremonyReportQuery = useQuery({
    queryKey: ["ceremony-report", selectedCeremonyId],
    queryFn: () => getCeremonyReport(selectedCeremonyId!),
    enabled: !!selectedCeremonyId,
  });

  return (
    <Card
      title={`財務報表${templeId ? "" : "（全部廟宇合併）"}`}
      extra={
        activeTab === "range" ? (
          <DatePicker.RangePicker
            value={rangeDates}
            onChange={(v) => setRangeDates(v && v[0] && v[1] ? [v[0], v[1]] : null)}
          />
        ) : activeTab === "activity" ? (
          <Select
            style={{ width: 260 }}
            placeholder="請選擇活動"
            value={selectedCeremonyId}
            onChange={setSelectedCeremonyId}
            options={(ceremoniesQuery.data ?? []).map((c) => ({ value: c.id, label: `${c.name}（${c.date}）` }))}
          />
        ) : (
          <DatePicker value={date} onChange={(v) => v && setDate(v)} />
        )
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "daily",
            label: `每日結帳（${date.format("YYYY-MM-DD")}）`,
            children: (
              <ReportContent
                report={dailyQuery.data}
                periodLabel={`每日結帳 ${date.format("YYYY-MM-DD")}`}
                fileLabel={`daily_${date.format("YYYY-MM-DD")}`}
                active={activeTab === "daily"}
                topSummaryLabel="今日總計金額"
              />
            ),
          },
          {
            key: "monthly",
            label: `每月收支（${date.format("YYYY-MM")}）`,
            children: (
              <ReportContent
                report={monthlyQuery.data}
                periodLabel={`每月收支 ${date.format("YYYY-MM")}`}
                fileLabel={`monthly_${date.format("YYYY-MM")}`}
                active={activeTab === "monthly"}
              />
            ),
          },
          {
            key: "annual",
            label: `年度結算（${date.year()}）`,
            children: (
              <ReportContent
                report={annualQuery.data}
                periodLabel={`年度結算 ${date.year()}`}
                fileLabel={`annual_${date.year()}`}
                active={activeTab === "annual"}
              />
            ),
          },
          {
            key: "range",
            label: rangeDates
              ? `區間查詢（${rangeDates[0].format("YYYY-MM-DD")} ~ ${rangeDates[1].format("YYYY-MM-DD")}）`
              : "區間查詢",
            children: rangeDates ? (
              <ReportContent
                report={rangeQuery.data}
                periodLabel={`區間查詢 ${rangeDates[0].format("YYYY-MM-DD")} ~ ${rangeDates[1].format("YYYY-MM-DD")}`}
                fileLabel={`range_${rangeDates[0].format("YYYY-MM-DD")}_${rangeDates[1].format("YYYY-MM-DD")}`}
                active={activeTab === "range"}
              />
            ) : (
              <Alert type="info" showIcon message="請先在右上角選擇查詢的起訖日期" />
            ),
          },
          {
            key: "activity",
            label: "活動查詢",
            children: selectedCeremonyId ? (
              <CeremonyReportContent report={ceremonyReportQuery.data} active={activeTab === "activity"} />
            ) : (
              <Alert type="info" showIcon message="請先在右上角選擇要查詢的活動" />
            ),
          },
        ]}
      />
    </Card>
  );
}

export function FinancePage() {
  const { user } = useAuth();
  const { activeTempleId } = useTemple();
  const templeId = activeTempleId === ALL_TEMPLES ? undefined : activeTempleId;
  const canReview = user?.role === UserRole.FINANCE || user?.role === UserRole.DIRECTOR;
  const isRegistrar = user?.role === UserRole.REGISTRAR;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {!isRegistrar && (
        <>
          {!canReview && (
            <Alert
              type="info"
              showIcon
              message="您送出的流水帳項目將送交財務人員審核後才會列入報表"
            />
          )}
          {templeId ? (
            <LedgerEntryForm templeId={templeId} />
          ) : (
            <Alert type="info" showIcon message="請先在上方選擇一間廟宇，才能新增該廟的流水帳項目" />
          )}
          {canReview && <PendingReview templeId={templeId} />}
          {canReview && <AuditCalendar templeId={templeId} />}
          {canReview && <ReportPanel templeId={templeId} />}
        </>
      )}
      {isRegistrar && <DailyReportOnly templeId={templeId} />}
    </Space>
  );
}
