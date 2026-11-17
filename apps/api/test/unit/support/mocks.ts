import { QueryFailedError } from "typeorm";

let idCounter = 0;
export const nextId = () => `id-${++idCounter}`;

/** 可以一路 .where().andWhere()… 串下去的假 QueryBuilder；終端方法（getMany/execute…）回傳值可在測試裡覆寫 */
export function mockQueryBuilder() {
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    "select",
    "addSelect",
    "where",
    "andWhere",
    "groupBy",
    "addGroupBy",
    "orderBy",
    "update",
    "set",
    "setParameters",
    "returning",
    "innerJoin",
    "leftJoin",
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawOne = jest.fn().mockResolvedValue(undefined);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
  return qb;
}

const withId = <T extends object>(row: T): T & { id: string; createdAt: Date } => ({
  id: (row as { id?: string }).id ?? nextId(),
  createdAt: (row as { createdAt?: Date }).createdAt ?? new Date("2026-01-01T00:00:00Z"),
  ...row,
});

/**
 * 假的 TypeORM Repository：預設「查不到任何資料、存檔一律成功並補上 id」。
 * 白箱測試依照要走的分支，用 mockResolvedValue / mockRejectedValue 覆寫個別方法。
 */
export function mockRepo() {
  const qb = mockQueryBuilder();
  // 交易內的查詢（例如進香報名鎖住活動後再算剩餘房間與座位）用另一個假 QueryBuilder，才能跟交易外的查詢分開設定
  const txQb = mockQueryBuilder();
  const txManager = {
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (row: object) => withId(row)),
    getRepository: jest.fn(),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(() => txQb),
  };
  return {
    qb,
    txQb,
    txManager,
    create: jest.fn((data: object | object[]) => (Array.isArray(data) ? data.map((d) => ({ ...d })) : { ...data })),
    save: jest.fn(async (data: object | object[]) => (Array.isArray(data) ? data.map(withId) : withId(data))),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findByIds: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    remove: jest.fn(async (row: unknown) => row),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    increment: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(() => qb),
    manager: {
      transaction: jest.fn(async (work: (m: typeof txManager) => unknown) => work(txManager)),
      // 查廟宇是否存在（建立活動／燈牆時使用）：預設存在，要測「廟宇不存在」時覆寫成 null
      findOne: jest.fn().mockResolvedValue({ id: "t1" }),
      createQueryBuilder: jest.fn(() => qb),
    },
  };
}
export type MockRepo = ReturnType<typeof mockRepo>;

/** PostgreSQL 唯一約束衝突（錯誤碼 23505），用來走「被別人搶先」的分支 */
export function uniqueViolation(): QueryFailedError {
  return Object.assign(new QueryFailedError("INSERT", [], new Error("duplicate key")), { code: "23505" });
}

/** 其他資料庫錯誤（不是唯一約束），用來確認程式不會把所有錯誤都當成「被搶先」吞掉 */
export function otherDbError(): QueryFailedError {
  return Object.assign(new QueryFailedError("INSERT", [], new Error("connection lost")), { code: "08006" });
}
