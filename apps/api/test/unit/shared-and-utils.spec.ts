import {
  PILGRIMAGE_BUS_DOOR_ROWS,
  PILGRIMAGE_BUS_ROWS,
  PILGRIMAGE_BUS_SEAT_COUNT,
  PILGRIMAGE_BUS_SEATS_PER_ROW,
  isPilgrimageBusSeat,
} from "@tms/shared";
import { formatLocalDate } from "../../src/common/date-utils";
import { LunarService } from "../../src/household/lunar.service";

/** 白箱：進香遊覽車座位配置（shared），逐一走過 isPilgrimageBusSeat 的每個判斷分支 */
describe("進香遊覽車座位配置 isPilgrimageBusSeat", () => {
  const index = (row: number, col: number) => (row - 1) * PILGRIMAGE_BUS_SEATS_PER_ROW + col;

  it("配置常數：12 排、每排 4 號、共 40 座；門在右側第 1、2、7、8 排", () => {
    expect(PILGRIMAGE_BUS_ROWS).toBe(12);
    expect(PILGRIMAGE_BUS_SEATS_PER_ROW).toBe(4);
    expect(PILGRIMAGE_BUS_SEAT_COUNT).toBe(40);
    expect(Object.keys(PILGRIMAGE_BUS_DOOR_ROWS).map(Number)).toEqual([1, 2, 7, 8]);
  });

  it.each([0, -1, 49, 100])("超出範圍的流水號 %d → 不是座位", (seatIndex) => {
    expect(isPilgrimageBusSeat(seatIndex)).toBe(false);
  });

  it.each([1.5, NaN, Infinity])("不是整數的 %d → 不是座位", (seatIndex) => {
    expect(isPilgrimageBusSeat(seatIndex)).toBe(false);
  });

  it("邊界：第一個（1）與最後一個（48）都是座位", () => {
    expect(isPilgrimageBusSeat(1)).toBe(true);
    expect(isPilgrimageBusSeat(48)).toBe(true);
  });

  it("左側（1、2 號）每一排都有座位，包含有門的那幾排", () => {
    for (let row = 1; row <= PILGRIMAGE_BUS_ROWS; row++) {
      expect(isPilgrimageBusSeat(index(row, 1))).toBe(true);
      expect(isPilgrimageBusSeat(index(row, 2))).toBe(true);
    }
  });

  it("右側（3、4 號）：有門的排沒有座位，其他排有", () => {
    for (let row = 1; row <= PILGRIMAGE_BUS_ROWS; row++) {
      const hasDoor = [1, 2, 7, 8].includes(row);
      expect(isPilgrimageBusSeat(index(row, 3))).toBe(!hasDoor);
      expect(isPilgrimageBusSeat(index(row, 4))).toBe(!hasDoor);
    }
  });

  it("逐一數出來的座位數與常數一致", () => {
    const count = Array.from({ length: 48 }, (_, i) => i + 1).filter(isPilgrimageBusSeat).length;
    expect(count).toBe(PILGRIMAGE_BUS_SEAT_COUNT);
  });
});

describe("formatLocalDate", () => {
  it("用本地時間組出 YYYY-MM-DD，月、日補零", () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatLocalDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("接近午夜也不會因為時區換算跑掉一天", () => {
    expect(formatLocalDate(new Date(2026, 4, 17, 23, 59, 59))).toBe("2026-05-17");
    expect(formatLocalDate(new Date(2026, 4, 17, 0, 0, 0))).toBe("2026-05-17");
  });
});

/** 白箱：農曆換算與犯太歲判斷，涵蓋簡體轉繁體、值太歲／沖太歲／無關／查不到生肖四個分支 */
describe("LunarService", () => {
  const service = new LunarService();

  describe("convertSolarToLunar", () => {
    it("國曆換農曆與生肖", () => {
      expect(service.convertSolarToLunar("1990-05-15")).toEqual({ lunarDateText: "庚午年 四月廿一", zodiac: "馬" });
    });

    it("農曆新年前出生的人，生肖算前一年（1990-01-15 還是蛇年）", () => {
      expect(service.convertSolarToLunar("1990-01-15").zodiac).toBe("蛇");
    });
  });

  describe("getZodiacOfYear：套件回傳簡體字的四個生肖要轉成繁體", () => {
    it.each([
      [2024, "龍"],
      [2026, "馬"],
      [2029, "雞"],
      [2031, "豬"],
    ])("%d 年是 %s 年", (year, zodiac) => {
      expect(service.getZodiacOfYear(year)).toBe(zodiac);
    });

    it("繁簡同形的生肖維持原樣（2025 蛇、2020 鼠）", () => {
      expect(service.getZodiacOfYear(2025)).toBe("蛇");
      expect(service.getZodiacOfYear(2020)).toBe("鼠");
    });
  });

  describe("checkZodiacClash（2026 馬年）", () => {
    it("同生肖：值太歲", () => {
      expect(service.checkZodiacClash("馬", 2026)).toEqual({ isClashYear: true, reason: "值太歲" });
    });
    it("相差六位（鼠）：沖太歲", () => {
      expect(service.checkZodiacClash("鼠", 2026)).toEqual({ isClashYear: true, reason: "沖太歲" });
    });
    it.each(["牛", "虎", "兔", "龍", "蛇", "羊", "猴", "雞", "狗", "豬"])("%s：不犯太歲", (zodiac) => {
      expect(service.checkZodiacClash(zodiac, 2026)).toEqual({ isClashYear: false, reason: null });
    });
    it("查不到的生肖（空字串、亂填）：當成不犯太歲，不會出錯", () => {
      expect(service.checkZodiacClash("", 2026)).toEqual({ isClashYear: false, reason: null });
      expect(service.checkZodiacClash("貓", 2026)).toEqual({ isClashYear: false, reason: null });
    });
    it("生肖循環跨過 12 的邊界也算得對（2020 鼠年，馬沖太歲）", () => {
      expect(service.checkZodiacClash("馬", 2020)).toEqual({ isClashYear: true, reason: "沖太歲" });
    });
  });
});
