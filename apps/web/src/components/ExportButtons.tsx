import { useEffect } from "react";
import { App, Button, Space, Tooltip } from "antd";
import { FileExcelOutlined } from "@ant-design/icons";

interface Props {
  onExportExcel: () => void;
  /** 是否啟用 Ctrl+Shift+E 快捷鍵（同一頁若有多組 ExportButtons，只讓目前作用中的那一組啟用即可） */
  shortcutEnabled?: boolean;
}

export function ExportButtons({ onExportExcel, shortcutEnabled = true }: Props) {
  const { message } = App.useApp();

  useEffect(() => {
    if (!shortcutEnabled) return;
    function handler(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        onExportExcel();
        message.success("已匯出 Excel（快捷鍵 Ctrl+Shift+E）");
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onExportExcel, shortcutEnabled, message]);

  return (
    <Space>
      <Tooltip title="快捷鍵 Ctrl+Shift+E">
        <Button icon={<FileExcelOutlined />} onClick={onExportExcel}>
          匯出 Excel
        </Button>
      </Tooltip>
    </Space>
  );
}
