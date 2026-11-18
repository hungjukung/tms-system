import { useState } from "react";
import { Card, DatePicker, Select, Space, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { AUDIT_ACTION_LABEL, AuditLogDto } from "@tms/shared";
import { listAuditLogs } from "../api/audit";

const ACTION_COLOR: Record<string, string> = {
  PILGRIMAGE_MOVE: "blue",
  CEREMONY_CREATE: "green",
  CEREMONY_UPDATE: "gold",
  CEREMONY_DELETE: "red",
  RECEIPT_DELETE: "red",
  RECEIPT_VOID: "volcano",
  RECEIPT_ISSUE: "default",
};

/** 操作紀錄：誰在什麼時候做了什麼（開立／作廢／刪除收據、建立／修改／刪除活動、調整進香房型與車次） */
export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [action, setAction] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const from = range?.[0]?.format("YYYY-MM-DD");
  const to = range?.[1]?.format("YYYY-MM-DD");
  const query = useQuery({
    queryKey: ["audit-logs", page, pageSize, action, from, to],
    queryFn: () => listAuditLogs({ page, pageSize, action, from, to }),
  });

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        操作紀錄
      </Typography.Title>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder="全部操作"
            style={{ minWidth: 200 }}
            value={action}
            onChange={(value) => {
              setAction(value);
              setPage(1);
            }}
            options={Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <DatePicker.RangePicker
            value={range}
            onChange={(value) => {
              setRange(value);
              setPage(1);
            }}
            placeholder={["起始日期", "結束日期"]}
          />
        </Space>
        <Table<AuditLogDto>
          rowKey="id"
          size="small"
          loading={query.isLoading}
          dataSource={query.data?.items ?? []}
          scroll={{ x: "max-content" }}
          pagination={{
            current: page,
            pageSize,
            total: query.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 筆`,
            onChange: (p, size) => {
              setPage(size !== pageSize ? 1 : p);
              setPageSize(size);
            },
          }}
          columns={[
            {
              title: "時間",
              dataIndex: "createdAt",
              width: 150,
              render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
            },
            {
              title: "操作",
              dataIndex: "action",
              width: 150,
              render: (v: string) => <Tag color={ACTION_COLOR[v] ?? "default"}>{AUDIT_ACTION_LABEL[v] ?? v}</Tag>,
            },
            { title: "內容", dataIndex: "summary" },
            { title: "操作人", dataIndex: "userName", width: 120 },
          ]}
        />
      </Card>
    </Space>
  );
}
