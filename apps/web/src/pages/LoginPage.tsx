import { useState } from "react";
import { Button, Card, Form, Input, Typography, Alert } from "antd";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    navigate("/", { replace: true });
  }

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    setError(null);
    try {
      await login(values.username, values.password);
      navigate("/", { replace: true });
    } catch (err) {
      setError("帳號或密碼錯誤，請重新輸入");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#7a1f16" }}>
      <Card style={{ width: 420 }}>
        <Typography.Title level={2} style={{ textAlign: "center" }}>
          宮廟管理系統
        </Typography.Title>
        <Typography.Paragraph style={{ textAlign: "center", color: "#888" }}>
          請登入以繼續操作
        </Typography.Paragraph>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item label="帳號" name="username" rules={[{ required: true, message: "請輸入帳號" }]}>
            <Input size="large" autoFocus />
          </Form.Item>
          <Form.Item label="密碼" name="password" rules={[{ required: true, message: "請輸入密碼" }]}>
            <Input.Password size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            登入
          </Button>
        </Form>
      </Card>
    </div>
  );
}
