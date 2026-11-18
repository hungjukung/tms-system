import { AuditService } from "../../src/audit/audit.service";
import { mockRepo } from "./support/mocks";

/** 白箱：操作紀錄服務 */
describe("AuditService（白箱）", () => {
  it("record：存進資料表；沒給的欄位存 null", async () => {
    const repo = mockRepo();
    const service = new AuditService(repo as never);
    await service.record({ action: "CEREMONY_CREATE", entityType: "CEREMONY", summary: "建立", userId: "u1" });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CEREMONY_CREATE", entityId: null, templeId: null, performedByUserId: "u1" }),
    );
  });

  it("record：寫入失敗不會讓正事跟著失敗（吞掉錯誤、印出警告）", async () => {
    const repo = mockRepo();
    repo.save.mockRejectedValue(new Error("資料庫斷線"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = new AuditService(repo as never);
    await expect(service.record({ action: "X", entityType: "Y", summary: "z", userId: "u1" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("list：篩選條件用參數帶入（不拼進 SQL），日期以台灣時間的整天計算；分頁換算 OFFSET", async () => {
    const repo = mockRepo();
    repo.query
      .mockResolvedValueOnce([{ total: 3 }])
      .mockResolvedValueOnce([
        { id: "1", action: "RECEIPT_VOID", entityType: "RECEIPT", summary: "收據 R1", createdAt: new Date("2026-11-18T01:00:00Z"), userName: null },
      ]);
    const service = new AuditService(repo as never);
    const result = await service.list({ page: 2, pageSize: 10, action: "RECEIPT_VOID'; DROP TABLE x; --", from: "2026-11-01", to: "2026-11-30" });

    const [countSql, countArgs] = repo.query.mock.calls[0];
    expect(countSql).not.toContain("DROP TABLE");
    expect(countArgs).toEqual(["RECEIPT_VOID'; DROP TABLE x; --", "2026-11-01T00:00:00+08:00", "2026-11-30T00:00:00+08:00"]);
    expect(repo.query.mock.calls[1][0]).toContain("LIMIT 10 OFFSET 10");
    expect(result).toEqual({
      total: 3,
      items: [
        { id: "1", action: "RECEIPT_VOID", entityType: "RECEIPT", summary: "收據 R1", userName: "（已刪除的帳號）", createdAt: "2026-11-18T01:00:00.000Z" },
      ],
    });
  });
});
