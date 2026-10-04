import { TempleDto } from "@tms/shared";
import { apiClient } from "./client";

export async function listTemples(): Promise<TempleDto[]> {
  const res = await apiClient.get<TempleDto[]>("/temples");
  return res.data;
}
