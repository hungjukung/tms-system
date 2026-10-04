import { Navigate, Route, Routes } from "react-router-dom";
import { UserRole } from "@tms/shared";
import { AppLayout } from "./layout/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { HouseholdsPage } from "./pages/HouseholdsPage";
import { ActivityRegistrationPage } from "./pages/ActivityRegistrationPage";
import { CreateActivityPage } from "./pages/CreateActivityPage";
import { FinancePage } from "./pages/FinancePage";
import { InventoryPage } from "./pages/InventoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useAuth } from "./context/AuthContext";
import { TempleProvider } from "./context/TempleContext";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// 資料建檔人員只能新增信徒/戶籍資料，其餘頁面一律導回信徒管理頁
function RequireNotDataEntry({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user?.role === UserRole.DATA_ENTRY) return <Navigate to="/households" replace />;
  return children;
}

// 建立活動／物資庫存／系統設定屬管理頁面，資料建檔人員與報名櫃檯人員都不可進入
function RequireManagementAccess({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user?.role === UserRole.DATA_ENTRY) return <Navigate to="/households" replace />;
  if (user?.role === UserRole.REGISTRAR) return <Navigate to="/activity-registration" replace />;
  return children;
}

export function App() {
  const { user } = useAuth();
  const isDataEntry = user?.role === UserRole.DATA_ENTRY;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <TempleProvider>
              <AppLayout />
            </TempleProvider>
          </RequireAuth>
        }
      >
        <Route
          index
          element={<Navigate to={isDataEntry ? "/households" : "/activity-registration"} replace />}
        />
        <Route path="households" element={<HouseholdsPage />} />
        <Route
          path="activity-registration"
          element={
            <RequireNotDataEntry>
              <ActivityRegistrationPage />
            </RequireNotDataEntry>
          }
        />
        <Route
          path="create-activity"
          element={
            <RequireManagementAccess>
              <CreateActivityPage />
            </RequireManagementAccess>
          }
        />
        <Route
          path="finance"
          element={
            <RequireNotDataEntry>
              <FinancePage />
            </RequireNotDataEntry>
          }
        />
        <Route
          path="inventory"
          element={
            <RequireManagementAccess>
              <InventoryPage />
            </RequireManagementAccess>
          }
        />
        <Route
          path="settings"
          element={
            <RequireManagementAccess>
              <SettingsPage />
            </RequireManagementAccess>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
