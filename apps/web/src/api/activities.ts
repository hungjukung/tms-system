import { SubmitActivitiesRequest, SubmitActivitiesResponse } from "@tms/shared";
import { apiClient } from "./client";

export async function submitActivities(dto: SubmitActivitiesRequest): Promise<SubmitActivitiesResponse> {
  const res = await apiClient.post<SubmitActivitiesResponse>("/activities/submit", dto);
  return res.data;
}
