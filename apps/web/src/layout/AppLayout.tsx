import { useState } from "react";
import { Alert, Layout, Menu, Select, Space, Typography, Button, Tag, Drawer, Grid } from "antd";
import { MenuOutlined } from "@ant-design/icons";
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
  [UserRole.VIEWER]: "唯讀帳號",
};

export function AppLayout() {
  const { user, logout } = useAuth();
  const { temples, activeTempleId, setActiveTempleId } = useTemple();
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 手機、直立的平板（寬度小於 md 768px）：頂部只留標題與選單按鈕，其他放進側邊抽屜
  const screens = Grid.useBreakpoint();
  const isCompact = !screens.md;

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
          ...(user?.role === UserRole.DIRECTOR || user?.role === UserRole.VIEWER
            ? [{ key: "/create-activity", label: "建立活動" }]
            : []),
          ...(user?.role === UserRole.DIRECTOR || user?.role === UserRole.VIEWER
            ? [{ key: "/settings", label: "系統設定" }]
            : []),
          ...(user?.role === UserRole.DIRECTOR || user?.role === UserRole.VIEWER
            ? [{ key: "/audit-log", label: "操作紀錄" }]
            : []),
        ];

  return (
    <Layout className="app-shell">
      {isCompact ? (
        <Header className="app-header-compact">
          <Typography.Title level={4} style={{ color: "#fff", margin: 0, flex: 1, whiteSpace: "nowrap" }}>
            {items.find((i) => i.key === location.pathname)?.label ?? "宮廟管理系統"}
          </Typography.Title>
          <Button
            type="text"
            aria-label="開啟選單"
            icon={<MenuOutlined style={{ color: "#fff", fontSize: 22 }} />}
            onClick={() => setDrawerOpen(true)}
          />
          <Drawer
            title="宮廟管理系統"
            placement="right"
            width={Math.min(320, typeof window !== "undefined" ? window.innerWidth - 40 : 320)}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          >
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Space wrap>
                <Tag color="gold">{user ? roleLabel[user.role] : ""}</Tag>
                <Typography.Link
                  onClick={() => {
                    setDrawerOpen(false);
                    setProfileOpen(true);
                  }}
                >
                  {user?.displayName}
                </Typography.Link>
              </Space>
              <Select
                value={activeTempleId}
                style={{ width: "100%" }}
                onChange={setActiveTempleId}
                options={[
                  ...temples.map((t) => ({ value: t.id, label: t.name })),
                  { value: ALL_TEMPLES, label: "全部（合併）" },
                ]}
              />
              <Menu
                mode="vertical"
                selectedKeys={[location.pathname]}
                items={items}
                style={{ borderInlineEnd: "none" }}
                onClick={(e) => {
                  setDrawerOpen(false);
                  navigate(e.key);
                }}
              />
              <Button block onClick={logout}>
                登出
              </Button>
            </Space>
          </Drawer>
        </Header>
      ) : (
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
      )}

      <MyProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      {user?.role === UserRole.VIEWER && (
        <Alert
          type="info"
          showIcon
          banner
          message="目前登入的是唯讀帳號：可檢視所有頁面與資料，但任何新增/修改/刪除操作都會被系統擋下"
        />
      )}
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
      <Content style={{ padding: isCompact ? 12 : 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
