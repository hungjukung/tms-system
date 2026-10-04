import {
  AdjustInventoryStockRequest,
  CreateInventoryItemRequest,
  InventoryItemDto,
  InventoryTransactionDto,
} from "@tms/shared";
import { apiClient } from "./client";

export async function listInventoryItems(): Promise<InventoryItemDto[]> {
  const res = await apiClient.get<InventoryItemDto[]>("/inventory/items");
  return res.data;
}

export async function listLowStockItems(): Promise<InventoryItemDto[]> {
  const res = await apiClient.get<InventoryItemDto[]>("/inventory/items/low-stock");
  return res.data;
}

export async function createInventoryItem(dto: CreateInventoryItemRequest): Promise<InventoryItemDto> {
  const res = await apiClient.post<InventoryItemDto>("/inventory/items", dto);
  return res.data;
}

export async function adjustInventoryStock(
  itemId: string,
  dto: AdjustInventoryStockRequest,
): Promise<InventoryItemDto> {
  const res = await apiClient.post<InventoryItemDto>(`/inventory/items/${itemId}/adjust`, dto);
  return res.data;
}

export async function listInventoryTransactions(itemId: string): Promise<InventoryTransactionDto[]> {
  const res = await apiClient.get<InventoryTransactionDto[]>(`/inventory/items/${itemId}/transactions`);
  return res.data;
}
