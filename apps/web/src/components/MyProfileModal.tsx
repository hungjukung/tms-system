import { useEffect } from "react";
import { Divider, Form, Input, Modal, Space, Typography, message } from "antd";
import { useMutation } from "@tanstack/react-query";
import { changeOwnPassword, updateOwnProfile } from "../api/auth";
import { useAuth } from "../context/AuthContext";

export function MyProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, updateUser } = useAuth();
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  useEffect(() => {
    if (open && user) {
      profileForm.setFieldsValue({ username: user.username, displayName: user.displayName });
      passwordForm.resetFields();
    }
  }, [open, user, profileForm, passwordForm]);

  const profileMutation = useMutation({
    mutationFn: updateOwnProfile,
    onSuccess: (updated) => {
      updateUser(updated);
      message.success("已更新個人資料");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "更新失敗，請重試");
    },
  });

  const passwordMutation = useMutation({
    mutationFn: changeOwnPassword,
    onSuccess: () => {
      message.success("已變更密碼");
      passwordForm.resetFields();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "變更失敗，請重試");
    },
  });

  return (
    <Modal title="個人資料" open={open} onCancel={onClose} footer={null}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Form form={profileForm} layout="vertical" onFinish={(values) => profileMutation.mutate(values)}>
          <Form.Item label="帳號" name="username" rules={[{ required: true, message: "請輸入帳號" }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item label="顯示名稱" name="displayName" rules={[{ required: true, message: "請輸入顯示名稱" }]}>
            <Input />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Typography.Link onClick={() => profileForm.submit()}>
              {profileMutation.isPending ? "儲存中..." : "儲存基本資料"}
            </Typography.Link>
          </Form.Item>
        </Form>

        <Divider style={{ margin: 0 }} />

        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={(values) =>
            passwordMutation.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword })
          }
        >
          <Typography.Text strong>變更密碼</Typography.Text>
          <Form.Item
            label="目前密碼"
            name="currentPassword"
            rules={[{ required: true, message: "請輸入目前密碼" }]}
            style={{ marginTop: 12 }}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            label="新密碼（至少 4 碼）"
            name="newPassword"
            rules={[{ required: true, min: 4, message: "至少 4 碼" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="確認新密碼"
            name="confirmPassword"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "請再輸入一次新密碼" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || value === getFieldValue("newPassword")) return Promise.resolve();
                  return Promise.reject(new Error("兩次輸入的新密碼不一致"));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Typography.Link onClick={() => passwordForm.submit()}>
              {passwordMutation.isPending ? "變更中..." : "變更密碼"}
            </Typography.Link>
          </Form.Item>
        </Form>
      </Space>
    </Modal>
  );
}
