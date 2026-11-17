import { ArgumentsHost, BadRequestException, ConflictException } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { DatabaseExceptionFilter } from "../../src/common/database-exception.filter";
import { positiveInt, requireDateParam, requireIntParam } from "../../src/common/query-utils";
import { LanternService } from "../../src/lantern/lantern.service";
import { mockRepo, otherDbError, uniqueViolation } from "./support/mocks";

describe("positiveInt（分頁參數）", () => {
  it.each([
    ["3", 1, 3],
    [5, 1, 5],
    ["1", 1, 1],
  ])("合法的正整數 %s 照用", (value, fallback, expected) => {
    expect(positiveInt(value, fallback)).toBe(expected);
  });

  it.each([undefined, null, "", "abc", "0", "-1", "1.5", NaN, "Infinity"])("不合法的 %p 用預設值", (value) => {
    expect(positiveInt(value, 20)).toBe(20);
  });

  it("超過上限就收斂到上限（邊界：剛好等於上限不變）", () => {
    expect(positiveInt("500", 20)).toBe(500);
    expect(positiveInt("501", 20)).toBe(500);
    expect(positiveInt("999999", 20, 1000)).toBe(1000);
  });
});

describe("requireDateParam", () => {
  it("合法日期原樣回傳（含閏年 2/29）", () => {
    expect(requireDateParam("2026-05-17", "日期")).toBe("2026-05-17");
    expect(requireDateParam("2024-02-29", "日期")).toBe("2024-02-29");
  });

  it.each([undefined, null, "", "abc", "2026-5-17", "2026/05/17", "2026-02-30", "2026-13-01", "2025-02-29", "2026-05-17T00:00", 20260517])(
    "不合法的 %p：400，訊息帶欄位名稱",
    (value) => {
      expect(() => requireDateParam(value, "起始日期")).toThrow(new BadRequestException("起始日期格式不正確，請使用 YYYY-MM-DD"));
    },
  );
});

describe("requireIntParam", () => {
  it("範圍內的整數（含邊界）可以", () => {
    expect(requireIntParam("1", "月份", 1, 12)).toBe(1);
    expect(requireIntParam("12", "月份", 1, 12)).toBe(12);
    expect(requireIntParam(2026, "年份", 1900, 9999)).toBe(2026);
  });

  it.each([undefined, "", "abc", "0", "13", "1.5", "-1"])("不合法的 %p：400", (value) => {
    expect(() => requireIntParam(value, "月份", 1, 12)).toThrow(new BadRequestException("月份不正確"));
  });
});

describe("DatabaseExceptionFilter", () => {
  const dbError = (code: string) => Object.assign(new QueryFailedError("SELECT", [], new Error("x")), { code });
  const run = (exception: QueryFailedError) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status, json, headersSent: false };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}) }),
      getType: () => "http",
      getArgByIndex: (index: number) => (index === 1 ? response : {}),
    } as unknown as ArgumentsHost;
    const filter = new DatabaseExceptionFilter();
    // BaseExceptionFilter 沒有 applicationRef 時直接用 response 回應
    (filter as any).applicationRef = { reply: (res: any, body: unknown, code: number) => res.status(code).json(body), isHeadersSent: () => false };
    filter.catch(exception, host);
    return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
  };

  it.each(["22P02", "22007", "22008", "22003", "2201W", "2201X"])("輸入格式錯誤的資料庫錯誤碼 %s → 400", (code) => {
    const { status, body } = run(dbError(code));
    expect(status).toBe(400);
    expect(body.message).toBe("輸入的資料格式不正確");
  });

  it.each(["23505", "08006", "42P01"])("其他資料庫錯誤 %s 仍然是 500", (code) => {
    expect(run(dbError(code)).status).toBe(500);
  });
});

describe("收據編號重複時重試（saveReceiptWithUniqueNo）", () => {
  const build = () => {
    const receiptRepo = mockRepo();
    const service = new LanternService(
      mockRepo() as never,
      mockRepo() as never,
      mockRepo() as never,
      mockRepo() as never,
      receiptRepo as never,
      mockRepo() as never,
      mockRepo() as never,
      mockRepo() as never,
      mockRepo() as never,
      mockRepo() as never,
      {} as never,
      {} as never,
    );
    return { receiptRepo, save: (data: object) => (service as any).saveReceiptWithUniqueNo(data) };
  };

  afterEach(() => jest.restoreAllMocks());

  it("第一組號碼沒人用：直接存", async () => {
    const { receiptRepo, save } = build();
    const saved = await save({ templeId: "t1" });
    expect(saved.receiptNo).toMatch(/^R\d{8}\d{6}$/);
    expect(receiptRepo.save).toHaveBeenCalledTimes(1);
  });

  it("查到號碼已被使用：換一組再試，不會嘗試存重複的號碼", async () => {
    const { receiptRepo, save } = build();
    receiptRepo.findOne.mockResolvedValueOnce({ id: "x" }).mockResolvedValueOnce({ id: "y" }).mockResolvedValue(null);
    await save({});
    expect(receiptRepo.findOne).toHaveBeenCalledTimes(3);
    expect(receiptRepo.save).toHaveBeenCalledTimes(1);
  });

  it("查的時候沒人用、存的時候被別人搶先（唯一約束）：換一組再試", async () => {
    const { receiptRepo, save } = build();
    receiptRepo.save.mockRejectedValueOnce(uniqueViolation());
    await save({});
    expect(receiptRepo.save).toHaveBeenCalledTimes(2);
  });

  it("連續 10 次都撞號：409，不會無限重試", async () => {
    const { receiptRepo, save } = build();
    receiptRepo.findOne.mockResolvedValue({ id: "x" });
    await expect(save({})).rejects.toThrow(new ConflictException("收據編號產生失敗，請重新送出"));
    expect(receiptRepo.findOne).toHaveBeenCalledTimes(10);
    expect(receiptRepo.save).not.toHaveBeenCalled();
  });

  it("其他資料庫錯誤不重試，原樣往外丟", async () => {
    const { receiptRepo, save } = build();
    const err = otherDbError();
    receiptRepo.save.mockRejectedValue(err);
    await expect(save({})).rejects.toBe(err);
    expect(receiptRepo.save).toHaveBeenCalledTimes(1);
  });
});
