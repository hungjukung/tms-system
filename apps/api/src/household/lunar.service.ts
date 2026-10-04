import { Injectable } from "@nestjs/common";
import { Solar } from "lunar-typescript";

const ZODIAC_ORDER = ["鼠", "牛", "虎", "兔", "龍", "蛇", "馬", "羊", "猴", "雞", "狗", "豬"];

// lunar-typescript 對「龍/馬/雞/豬」四個生肖回傳簡體字，其餘八個生肖繁簡同形，
// 統一轉換為繁體字，避免與 ZODIAC_ORDER 比對時因簡繁不一致而誤判
const SIMPLIFIED_TO_TRADITIONAL: Record<string, string> = {
  龙: "龍",
  马: "馬",
  鸡: "雞",
  猪: "豬",
};

function toTraditionalZodiac(zodiac: string): string {
  return SIMPLIFIED_TO_TRADITIONAL[zodiac] ?? zodiac;
}

export interface LunarConversionResult {
  lunarDateText: string;
  zodiac: string;
}

export interface ZodiacClashResult {
  isClashYear: boolean;
  reason: "值太歲" | "沖太歲" | null;
}

@Injectable()
export class LunarService {
  /** 依國曆生日換算農曆日期字串與生肖 */
  convertSolarToLunar(solarDate: string): LunarConversionResult {
    const [year, month, day] = solarDate.split("-").map(Number);
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();
    return {
      lunarDateText: `${lunar.getYearInGanZhi()}年 ${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
      zodiac: toTraditionalZodiac(lunar.getYearShengXiao()),
    };
  }

  /** 取得指定西元年的生肖（用來判斷當年犯太歲/沖太歲） */
  getZodiacOfYear(year: number): string {
    // 農曆新年通常落在 1~2 月，取年中日期可避免跨年界誤判
    const solar = Solar.fromYmd(year, 6, 15);
    return toTraditionalZodiac(solar.getLunar().getYearShengXiao());
  }

  /** 判斷信徒生肖在指定西元年是否犯太歲（值太歲）或沖太歲（對沖） */
  checkZodiacClash(memberZodiac: string, year: number): ZodiacClashResult {
    const currentZodiac = this.getZodiacOfYear(year);
    const memberIndex = ZODIAC_ORDER.indexOf(memberZodiac);
    const currentIndex = ZODIAC_ORDER.indexOf(currentZodiac);
    if (memberIndex === -1 || currentIndex === -1) {
      return { isClashYear: false, reason: null };
    }
    const diff = (currentIndex - memberIndex + 12) % 12;
    if (diff === 0) {
      return { isClashYear: true, reason: "值太歲" };
    }
    if (diff === 6) {
      return { isClashYear: true, reason: "沖太歲" };
    }
    return { isClashYear: false, reason: null };
  }
}
