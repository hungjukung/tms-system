import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
  message,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserAccountDto, UserRole } from "@tms/shared";
import { getSettings, updateSettings, uploadChairmanSeal, uploadTempleSeal } from "../api/settings";
import { createUserAccount, deleteUserAccount, listUsers, resetUserPassword, updateUserAccount } from "../api/users";
import { useAuth } from "../context/AuthContext";
import { ALL_TEMPLES, useTemple } from "../context/TempleContext";

const roleLabel: Record<UserRole, string> = {
  [UserRole.VOLUNTEER]: "志工/櫃台人員",
  [UserRole.FINANCE]: "財務人員",
  [UserRole.DIRECTOR]: "總幹事/主委",
  [UserRole.DATA_ENTRY]: "資料建檔人員（僅能新增信徒/戶籍資料，可多人共用同一帳號同時使用）",
  [UserRole.REGISTRAR]: "報名櫃檯人員（可辦理活動報名、新增信徒/戶籍資料、查看每日結帳）",
  [UserRole.VIEWER]: "唯讀帳號（可檢視所有頁面與資料，無法新增/修改/刪除任何資料）",
};

const roleOptions = Object.entries(roleLabel).map(([value, label]) => ({ value, label }));

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  const mutation = useMutation({
    mutationFn: createUserAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-accounts"] });
      message.success("已建立帳號");
      form.resetFields();
      onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "建立失敗，請重試");
    },
  });

  return (
    <Modal
      title="新增帳號"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
    >
      <Form form={form} layout="vertical" initialValues={{ role: UserRole.VOLUNTEER }} onFinish={(values) => mutation.mutate(values)}>
        <Form.Item label="帳號" name="username" rules={[{ required: true, message: "請輸入帳號" }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item label="密碼" name="password" rules={[{ required: true, min: 4, message: "至少 4 碼" }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item label="顯示名稱" name="displayName" rules={[{ required: true, message: "請輸入顯示名稱" }]}>
          <Input placeholder="例如：王小明" />
        </Form.Item>
        <Form.Item label="權限角色" name="role" rules={[{ required: true }]}>
          <Select options={roleOptions} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function EditUserModal({ target, onClose }: { target: UserAccountDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  const mutation = useMutation({
    mutationFn: (values: { username: string; displayName: string }) => updateUserAccount(target!.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-accounts"] });
      message.success("已更新帳號資料");
      onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "更新失敗，請重試");
    },
  });

  return (
    <Modal
      title={`編輯帳號：${target?.displayName ?? ""}`}
      open={!!target}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ username: target?.username, displayName: target?.displayName }}
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item label="帳號" name="username" rules={[{ required: true, message: "請輸入帳號" }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item label="顯示名稱" name="displayName" rules={[{ required: true, message: "請輸入顯示名稱" }]}>
          <Input placeholder="例如：王小明" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ResetPasswordModal({
  target,
  onClose,
}: {
  target: UserAccountDto | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: (newPassword: string) => resetUserPassword(target!.id, newPassword),
    onSuccess: () => {
      message.success("已重設密碼");
      setPassword("");
      onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "重設失敗，請重試");
    },
  });

  return (
    <Modal
      title={`重設密碼：${target?.displayName ?? ""}（${target?.username ?? ""}）`}
      open={!!target}
      onCancel={() => {
        setPassword("");
        onClose();
      }}
      onOk={() => mutation.mutate(password)}
      confirmLoading={mutation.isPending}
      okButtonProps={{ disabled: password.length < 4 }}
    >
      <Form layout="vertical">
        <Form.Item label="新密碼（至少 4 碼）">
          <Input.Password autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function AccountManagementCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserAccountDto | null>(null);
  const [resetTarget, setResetTarget] = useState<UserAccountDto | null>(null);

  const usersQuery = useQuery({ queryKey: ["user-accounts"], queryFn: listUsers });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Parameters<typeof updateUserAccount>[1] }) => updateUserAccount(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-accounts"] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "更新失敗，請重試");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUserAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-accounts"] });
      message.success("已刪除帳號");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "刪除失敗，請重試");
    },
  });

  return (
    <>
      <Card title="帳號權限管理" extra={<Button type="primary" onClick={() => setCreateModalOpen(true)}>新增帳號</Button>}>
        <Table
          rowKey="id"
          loading={usersQuery.isLoading}
          dataSource={usersQuery.data ?? []}
          pagination={false}
          columns={[
            { title: "帳號", dataIndex: "username" },
            { title: "顯示名稱", dataIndex: "displayName" },
            {
              title: "權限角色",
              dataIndex: "role",
              render: (role: UserRole, record: UserAccountDto) => (
                <Select
                  style={{ width: 160 }}
                  value={role}
                  options={roleOptions}
                  disabled={record.id === user?.id}
                  onChange={(value) => updateMutation.mutate({ id: record.id, dto: { role: value } })}
                />
              ),
            },
            {
              title: "啟用狀態",
              dataIndex: "active",
              render: (active: boolean, record: UserAccountDto) => (
                <Switch
                  checked={active}
                  disabled={record.id === user?.id}
                  onChange={(checked) => updateMutation.mutate({ id: record.id, dto: { active: checked } })}
                />
              ),
            },
            {
              title: "操作",
              render: (_: unknown, record: UserAccountDto) => (
                <Space>
                  <Button size="small" onClick={() => setEditTarget(record)}>
                    編輯
                  </Button>
                  <Button size="small" onClick={() => setResetTarget(record)}>
                    重設密碼
                  </Button>
                  {record.id === user?.id ? (
                    <Tag>本人</Tag>
                  ) : (
                    <Popconfirm
                      title="確定要刪除此帳號嗎？"
                      description="刪除後無法復原，該帳號過去建立的紀錄仍會保留，但經辦人等欄位會顯示為空"
                      okText="刪除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => deleteMutation.mutate(record.id)}
                    >
                      <Button danger size="small" loading={deleteMutation.isPending}>
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

      <CreateUserModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} />
      <EditUserModal target={editTarget} onClose={() => setEditTarget(null)} />
      <ResetPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} />
    </>
  );
}

function SealUploader({
  label,
  imagePath,
  templeId,
  onUpload,
}: {
  label: string;
  imagePath: string | null;
  templeId: string;
  onUpload: (templeId: string, file: File) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (file: File) => onUpload(templeId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["temple-settings", templeId] });
      message.success(`${label}已更新`);
    },
  });

  return (
    <Space direction="vertical">
      <Space align="start" size="large">
        <div style={{ width: 120, height: 120, border: "1px dashed #ccc", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {imagePath ? <Image src={imagePath} width={110} height={110} style={{ objectFit: "contain" }} /> : <span style={{ color: "#999" }}>尚未上傳</span>}
        </div>
        <Upload
          showUploadList={false}
          accept="image/png,image/jpeg,image/webp"
          beforeUpload={(file) => {
            mutation.mutate(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} loading={mutation.isPending}>
            上傳{label}
          </Button>
        </Upload>
      </Space>
    </Space>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const { activeTempleId } = useTemple();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const isDirector = user?.role === UserRole.DIRECTOR;

  const templeId = activeTempleId === ALL_TEMPLES ? undefined : activeTempleId;

  const settingsQuery = useQuery({
    queryKey: ["temple-settings", templeId],
    queryFn: () => getSettings(templeId!),
    enabled: !!templeId,
  });

  const updateMutation = useMutation({
    mutationFn: (values: Parameters<typeof updateSettings>[1]) => updateSettings(templeId!, values),
    onSuccess: (data) => {
      queryClient.setQueryData(["temple-settings", templeId], data);
      message.success("已儲存宮廟資料");
    },
  });

  if (!templeId) {
    return <Alert type="info" showIcon message="請先在上方選擇一間廟宇，才能檢視/編輯該廟的系統設定" />;
  }

  if (settingsQuery.isLoading || !settingsQuery.data) {
    return null;
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {!isDirector && (
        <Alert type="info" showIcon message="僅總幹事/主委可修改宮廟資料與印信圖片，此頁面為唯讀檢視" />
      )}
      <Card title="宮廟基本資料（用於收據 / 感謝狀列印）">
        <Form
          key={templeId}
          form={form}
          layout="vertical"
          initialValues={settingsQuery.data}
          disabled={!isDirector}
          onFinish={(values) => updateMutation.mutate(values)}
        >
          <Form.Item label="宮廟名稱" name="templeName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="管理委員會全名（例如：OO宮管理委員會）" name="committeeName">
            <Input />
          </Form.Item>
          <Form.Item label="地址" name="address">
            <Input />
          </Form.Item>
          <Form.Item label="電話" name="phone">
            <Input />
          </Form.Item>
          <Form.Item label="立案證號" name="registrationNo">
            <Input />
          </Form.Item>
          <Form.Item label="統一編號" name="taxId">
            <Input />
          </Form.Item>
          <Form.Item label="主委職稱（例如：主任委員）" name="chairmanTitle">
            <Input />
          </Form.Item>
          <Form.Item label="主委姓名" name="chairmanName">
            <Input />
          </Form.Item>
          {isDirector && (
            <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
              儲存
            </Button>
          )}
        </Form>
      </Card>

      {isDirector && (
        <Card title="印信圖片（會自動印在每張收據 / 感謝狀上）">
          <Space size="large">
            <SealUploader
              label="宮廟印信"
              imagePath={settingsQuery.data.templeSealImagePath}
              templeId={templeId}
              onUpload={uploadTempleSeal}
            />
            <SealUploader
              label="主委簽章"
              imagePath={settingsQuery.data.chairmanSealImagePath}
              templeId={templeId}
              onUpload={uploadChairmanSeal}
            />
          </Space>
        </Card>
      )}

      {isDirector && <AccountManagementCard />}
    </Space>
  );
}
