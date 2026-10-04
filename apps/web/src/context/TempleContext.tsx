import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { TempleDto } from "@tms/shared";
import { listTemples } from "../api/temples";

export const ALL_TEMPLES = "ALL" as const;
export type ActiveTempleId = string | typeof ALL_TEMPLES;

interface TempleContextValue {
  temples: TempleDto[];
  isLoading: boolean;
  activeTempleId: ActiveTempleId;
  /** 目前選定的廟宇（選「全部」時為 undefined），大部分頁面應優先用這個判斷是否已選定單一廟宇 */
  activeTemple: TempleDto | undefined;
  setActiveTempleId: (id: ActiveTempleId) => void;
}

const TempleContext = createContext<TempleContextValue | undefined>(undefined);

const STORAGE_KEY = "tms_active_temple_id";

export function TempleProvider({ children }: { children: ReactNode }) {
  const [activeTempleId, setActiveTempleIdState] = useState<ActiveTempleId>(
    () => localStorage.getItem(STORAGE_KEY) ?? ALL_TEMPLES,
  );

  const templesQuery = useQuery({ queryKey: ["temples"], queryFn: listTemples });
  const temples = templesQuery.data ?? [];

  // 第一次載入清單後，如果目前記錄的廟宇已不存在（例如清過資料庫），改回「全部」
  useEffect(() => {
    if (temples.length > 0 && activeTempleId !== ALL_TEMPLES && !temples.some((t) => t.id === activeTempleId)) {
      setActiveTempleIdState(ALL_TEMPLES);
    }
  }, [temples, activeTempleId]);

  function setActiveTempleId(id: ActiveTempleId) {
    localStorage.setItem(STORAGE_KEY, id);
    setActiveTempleIdState(id);
  }

  const activeTemple = temples.find((t) => t.id === activeTempleId);

  return (
    <TempleContext.Provider
      value={{ temples, isLoading: templesQuery.isLoading, activeTempleId, activeTemple, setActiveTempleId }}
    >
      {children}
    </TempleContext.Provider>
  );
}

export function useTemple() {
  const ctx = useContext(TempleContext);
  if (!ctx) throw new Error("useTemple 必須在 TempleProvider 內使用");
  return ctx;
}
