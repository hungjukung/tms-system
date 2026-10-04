import { useState } from "react";
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Radio, Space, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InventoryItemDto, InventoryTransactionType, UserRole } from "@tms/shared";
import { adjustInventoryStock, createInventoryItem, listInventoryItems } from "../api/inventory";
import { useAuth } from "../context/AuthContext";

function CreateItemForm() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  const mutation = useMutation({
    mutationFn: createInventoryItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      form.resetFields();
    },
  });

  return (
    <Card title="新增物資項目（總幹事/主委）">
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
        <Form.Item label="品項名稱" name="name" rules={[{ required: true }]}>
          <Input placeholder="例如：金紙、香、發財米、平安符" />
        </Form.Item>
        <Form.Item label="單位" name="unit" rules={[{ required: true }]}>
          <Input placeholder="例如：包、支、份" />
        </Form.Item>
        <Form.Item label="庫存警戒值" name="lowStockThreshold" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Form.Item label="目前庫存" name="initialStock" initialValue={0}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={mutation.isPending}>
          新增
        </Button>
      </Form>
    </Card>
  );
}

export function InventoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [adjustTarget, setAdjustTarget] = useState<InventoryItemDto | null>(null);
  const [form] = Form.useForm();

  const itemsQuery = useQuery({ queryKey: ["inventory-items"], queryFn: listInventoryItems });

  const adjustMutation = useMutation({
    mutationFn: ({ itemId, type, quantity, note }: { itemId: string; type: InventoryTransactionType; quantity: number; note?: string }) =>
      adjustInventoryStock(itemId, { type, quantity, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-items"] });
      setAdjustTarget(null);
      form.resetFields();
    },
  });

  const lowStockCount = (itemsQuery.data ?? []).filter((i) => i.isLowStock).length;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {lowStockCount > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`有 ${lowStockCount} 項物資庫存不足，請儘早採購`}
        />
      )}
      {user?.role === UserRole.DIRECTOR && <CreateItemForm />}
      <Card title="物資盤點">
        <Table
          rowKey="id"
          loading={itemsQuery.isLoading}
          dataSource={itemsQuery.data ?? []}
          pagination={false}
          columns={[
            { title: "品項", dataIndex: "name" },
            { title: "單位", dataIndex: "unit" },
            {
              title: "目前庫存",
              dataIndex: "currentStock",
              render: (v: number, record: InventoryItemDto) => (
                <span style={{ color: record.isLowStock ? "#a8071a" : undefined, fontWeight: record.isLowStock ? "bold" : undefined }}>
                  {v} {record.unit}
                </span>
              ),
            },
            { title: "警戒值", dataIndex: "lowStockThreshold" },
            {
              title: "狀態",
              dataIndex: "isLowStock",
              render: (v: boolean) => (v ? <Tag color="red">庫存不足</Tag> : <Tag color="green">正常</Tag>),
            },
            {
              title: "操作",
              render: (_, record: InventoryItemDto) => (
                <Button size="small" onClick={() => setAdjustTarget(record)}>
                  進貨 / 領用
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={`調整庫存：${adjustTarget?.name ?? ""}`}
        open={!!adjustTarget}
        onCancel={() => setAdjustTarget(null)}
        onOk={() => form.submit()}
        confirmLoading={adjustMutation.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ type: InventoryTransactionType.IN }}
          onFinish={(values) =>
            adjustTarget &&
            adjustMutation.mutate({
              itemId: adjustTarget.id,
              type: values.type,
              quantity: values.quantity,
              note: values.note,
            })
          }
        >
          <Form.Item label="類型" name="type">
            <Radio.Group>
              <Radio.Button value={InventoryTransactionType.IN}>進貨</Radio.Button>
              <Radio.Button value={InventoryTransactionType.OUT}>領用/銷售</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="數量" name="quantity" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
          <Form.Item label="備註" name="note">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
