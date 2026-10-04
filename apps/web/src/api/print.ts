import { ReceiptCertificateDataDto, ReceiptDetailDto, ReceiptSourceType } from "@tms/shared";
import { apiClient } from "./client";

export async function getReceiptCertificateData(receiptId: string): Promise<ReceiptCertificateDataDto> {
  const res = await apiClient.get<ReceiptCertificateDataDto>(`/print/receipt/${receiptId}/data`);
  return res.data;
}

/** 有提供 keyword 時依收據編號或信眾姓名（臨櫃姓名／已建檔信徒姓名）模糊搜尋，有提供 sourceType 時依活動類型篩選 */
export async function getReceiptDetails(
  keyword?: string,
  page = 1,
  pageSize = 20,
  sourceType?: ReceiptSourceType,
): Promise<{ items: ReceiptDetailDto[]; total: number; page: number; pageSize: number }> {
  const res = await apiClient.get<{ items: ReceiptDetailDto[]; total: number; page: number; pageSize: number }>(
    "/print/receipts/details",
    { params: { keyword: keyword || undefined, page, pageSize, sourceType } },
  );
  return res.data;
}

export async function getReceiptHtml(receiptId: string): Promise<string> {
  const res = await apiClient.get<string>(`/print/receipt/${receiptId}`, { responseType: "text" });
  return res.data;
}
