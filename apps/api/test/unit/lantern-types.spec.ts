import { BadRequestException } from "@nestjs/common";
import { DEFAULT_LANTERN_TYPES } from "@tms/shared";
import { assertLanternPrice, effectiveLanternTypes, normalizeLanternTypes } from "../../src/lantern/lantern-types";

/** 白箱：燈種與價格的檢查工具 */
describe("lantern-types（白箱）", () => {
  it("effectiveLanternTypes：沒設定（null／空陣列）用預設；有設定用設定；回傳複本不會改到共用常數", () => {
    expect(effectiveLanternTypes(null)).toEqual(DEFAULT_LANTERN_TYPES);
    expect(effectiveLanternTypes([])).toEqual(DEFAULT_LANTERN_TYPES);
    expect(effectiveLanternTypes([{ name: "太歲燈", price: 1 }])).toEqual([{ name: "太歲燈", price: 1 }]);
    effectiveLanternTypes(null)[0].price = 1;
    expect(DEFAULT_LANTERN_TYPES[0].price).toBe(5000);
  });

  it("預設清單就是 6 種燈種與價格", () => {
    expect(DEFAULT_LANTERN_TYPES.map((t) => `${t.name}=${t.price}`)).toEqual([
      "平安燈(大)=5000",
      "平安燈(中)=3000",
      "平安燈=1000",
      "發財燈=600",
      "光明燈=600",
      "太歲燈=500",
    ]);
  });

  describe("normalizeLanternTypes", () => {
    it("去掉名稱前後空白、價格四捨五入到分", () => {
      expect(normalizeLanternTypes([{ name: " 太歲燈 ", price: 500.004 }, { name: "光明燈", price: 0 }])).toEqual([
        { name: "太歲燈", price: 500 },
        { name: "光明燈", price: 0 },
      ]);
    });

    it.each([
      ["空陣列", [], "請至少設定一種燈種"],
      ["名稱空白", [{ name: "", price: 1 }], "燈種名稱不可空白"],
      ["含頓號", [{ name: "甲、乙", price: 1 }], "燈種名稱不可包含「、」"],
      ["重複", [{ name: "太歲燈", price: 1 }, { name: "太歲燈", price: 2 }], "燈種名稱不可重複"],
      ["負價格", [{ name: "太歲燈", price: -1 }], "燈種價格不可為負數"],
      ["價格不是數字", [{ name: "太歲燈", price: NaN }], "燈種價格不可為負數"],
      ["少了太歲燈", [{ name: "光明燈", price: 1 }], "燈種一定要保留「太歲燈」（太歲燈牆固定點這一種）"],
    ])("%s：400", (_label, input, message) => {
      expect(() => normalizeLanternTypes(input as never)).toThrow(new BadRequestException(message));
    });
  });

  describe("assertLanternPrice", () => {
    const types = [
      { name: "光明燈", price: 600 },
      { name: "小額燈", price: 0.1 },
    ];

    it("金額剛好等於價格 × 盞數才通過，回傳該燈種；前後空白不影響", () => {
      expect(assertLanternPrice(types, " 光明燈 ", 600)).toEqual({ name: "光明燈", price: 600 });
      expect(assertLanternPrice(types, "光明燈", 1800, 3).name).toBe("光明燈");
    });

    it("以「分」比對：0.1 × 3 = 0.3 不會因浮點誤差失敗", () => {
      expect(assertLanternPrice(types, "小額燈", 0.3, 3).price).toBe(0.1);
    });

    it("金額不對：單盞與多盞的訊息不同；燈種不存在或沒填：400", () => {
      expect(() => assertLanternPrice(types, "光明燈", 599)).toThrow("光明燈每盞 NT$ 600，金額不正確");
      expect(() => assertLanternPrice(types, "光明燈", 1200, 3)).toThrow("光明燈每盞 NT$ 600，3 盞應收 NT$ 1800");
      expect(() => assertLanternPrice(types, "豪華燈", 600)).toThrow("找不到燈種「豪華燈」，請重新選擇");
      expect(() => assertLanternPrice(types, undefined, 600)).toThrow("找不到燈種「」，請重新選擇");
    });
  });
});
