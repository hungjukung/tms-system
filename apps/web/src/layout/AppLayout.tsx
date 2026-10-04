import { useState } from "react";
import { Alert, Layout, Menu, Select, Space, Typography, Button, Tag } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { ALL_TEMPLES, useTemple } from "../context/TempleContext";
import { UserRole } from "@tms/shared";
import { listLowStockItems } from "../api/inventory";
import { MyProfileModal } from "../components/MyProfileModal";

const { Header, Content } = Layout;

const roleLabel: Record<UserRole, string> = {
  [UserRole.VOLUNTEER]: "志工/櫃台人員",
  [UserRole.FINANCE]: "財務人員",
  [UserRole.DIRECTOR]: "總幹事/主委",
  [UserRole.DATA_ENTRY]: "資料建檔人員",
  [UserRole.REGISTRAR]: "報名櫃檯人員",
};

export function AppLayout() {
  const { user, logout } = useAuth();
  const { temples, activeTempleId, setActiveTempleId } = useTemple();
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);

  const isDataEntry = user?.role === UserRole.DATA_ENTRY;
  const isRegistrar = user?.role === UserRole.REGISTRAR;

  const lowStockQuery = useQuery({
    queryKey: ["low-stock-items"],
    queryFn: listLowStockItems,
    refetchInterval: 5 * 60 * 1000,
    enabled: !isDataEntry && !isRegistrar,
  });
  const lowStockItems = lowStockQuery.data ?? [];

  const items = isDataEntry
    ? [{ key: "/households", label: "信徒管理" }]
    : isRegistrar
      ? [
          { key: "/activity-registration", label: "活動報名" },
          { key: "/households", label: "信徒管理" },
          { key: "/finance", label: "財務管理" },
        ]
      : [
          { key: "/activity-registration", label: "活動報名" },
          { key: "/households", label: "信徒管理" },
          { key: "/finance", label: "財務管理" },
          { key: "/inventory", label: "物資庫存" },
          ...(user?.role === UserRole.DIRECTOR ? [{ key: "/create-activity", label: "建立活動" }] : []),
          ...(user?.role === UserRole.DIRECTOR ? [{ key: "/settings", label: "系統設定" }] : []),
        ];

  return (
    <Layout className="app-shell">
      <Header style={{ display: "flex", alignItems: "center", background: "#7a1f16" }}>
        <Typography.Title level={3} style={{ color: "#fff", margin: 0, marginRight: 32 }}>
          宮廟管理系統
        </Typography.Title>
        <Menu
          theme="dark"
          mode="horizontal"
          style={{ flex: 1, background: "transparent" }}
          selectedKeys={[location.pathname]}
          items={items}
          onClick={(e) => navigate(e.key)}
        />
        <Space>
          <Select
            value={activeTempleId}
            style={{ width: 140 }}
            onChange={setActiveTempleId}
            options={[
              ...temples.map((t) => ({ value: t.id, label: t.name })),
              { value: ALL_TEMPLES, label: "全部（合併）" },
            ]}
          />
          <Tag color="gold">{user ? roleLabel[user.role] : ""}</Tag>
          <Typography.Link onClick={() => setProfileOpen(true)} style={{ color: "#fff", textDecoration: "underline" }}>
            {user?.displayName}
          </Typography.Link>
          <Button onClick={logout}>登出</Button>
        </Space>
      </Header>

      <MyProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      {!isDataEntry && !isRegistrar && lowStockItems.length > 0 && (
        <Alert
          type="warning"
          showIcon
          banner
          closable
          message={`庫存不足提醒：${lowStockItems.map((i) => `${i.name}（剩 ${i.currentStock} ${i.unit}）`).join("、")}`}
          action={
            <Button size="small" onClick={() => navigate("/inventory")}>
              前往物資庫存
            </Button>
          }
        />
      )}
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
