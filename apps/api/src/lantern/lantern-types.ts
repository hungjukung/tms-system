import { BadRequestException } from "@nestjs/common";
import { DEFAULT_LANTERN_TYPES, LanternTypePrice, TAISUI_LANTERN_TYPE } from "@tms/shared";

/** 廟宇沒設定過燈種時使用預設清單（回傳複本，避免呼叫端不小心改到共用常數） */
export function effectiveLanternTypes(stored: LanternTypePrice[] | null | undefined): LanternTypePrice[] {
  return (stored?.length ? stored : DEFAULT_LANTERN_TYPES).map((t) => ({ name: t.name, price: t.price }));
}

/**
 * 整理並檢查總幹事送來的燈種清單：至少一種；名稱去掉前後空白、不可空白、不可重複、不可含「、」
 * （點燈內容在資料庫裡以「、」分隔舊的複選資料）；價格不可為負；一定要保留「太歲燈」（太歲燈牆固定點這一種）。
 */
export function normalizeLanternTypes(input: { name: string; price: number }[]): LanternTypePrice[] {
  if (!input?.length) throw new BadRequestException("請至少設定一種燈種");
  const cleaned = input.map((t) => ({ name: String(t.name ?? "").trim(), price: Math.round(Number(t.price) * 100) / 100 }));
  if (cleaned.some((t) => !t.name)) throw new BadRequestException("燈種名稱不可空白");
  if (cleaned.some((t) => t.name.includes("、"))) throw new BadRequestException("燈種名稱不可包含「、」");
  if (new Set(cleaned.map((t) => t.name)).size !== cleaned.length) throw new BadRequestException("燈種名稱不可重複");
  if (cleaned.some((t) => !Number.isFinite(t.price) || t.price < 0)) throw new BadRequestException("燈種價格不可為負數");
  if (!cleaned.some((t) => t.name === TAISUI_LANTERN_TYPE)) {
    throw new BadRequestException(`燈種一定要保留「${TAISUI_LANTERN_TYPE}」（太歲燈牆固定點這一種）`);
  }
  return cleaned;
}

/**
 * 點燈金額必須剛好是「燈種價格 × 盞數」（以「分」比對避免小數誤差）。
 * 燈種必須是設定清單裡的其中一種（單一燈種，不可複選）。
 */
export function assertLanternPrice(types: LanternTypePrice[], lanternType: string | undefined | null, amount: number, count = 1): LanternTypePrice {
  const name = (lanternType ?? "").trim();
  const type = types.find((t) => t.name === name);
  if (!type) throw new BadRequestException(`找不到燈種「${name}」，請重新選擇`);
  const expected = Math.round(type.price * 100) * count;
  if (Math.round(amount * 100) !== expected) {
    throw new BadRequestException(
      count > 1
        ? `${type.name}每盞 NT$ ${type.price}，${count} 盞應收 NT$ ${expected / 100}`
        : `${type.name}每盞 NT$ ${type.price}，金額不正確`,
    );
  }
  return type;
}
