import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RocDateInput } from "../src/components/RocDateInput";

describe("RocDateInput 民國年生日輸入", () => {
  const type = (value: string) => {
    const onChange = vi.fn();
    const view = render(<RocDateInput onChange={onChange} />);
    const input = view.getByPlaceholderText(/民國年/) as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    return { onChange, input };
  };

  it("輸入滿 7 碼才轉成西元日期（099/03/15 → 2010-03-15）", () => {
    const { onChange, input } = type("0990315");
    expect(onChange).toHaveBeenLastCalledWith("2010-03-15");
    expect(input.value).toBe("099/03/15");
  });

  it("邊界值：6 碼還不算輸入完成（回傳 undefined），畫面先顯示已輸入的部分", () => {
    const { onChange, input } = type("099031");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(input.value).toBe("099/03/1");
  });

  it("自動加斜線：3 碼以內不加", () => {
    expect(type("099").input.value).toBe("099");
  });

  it("自動加斜線：4～5 碼加一個", () => {
    expect(type("0990").input.value).toBe("099/0");
  });

  it("非數字會被濾掉，超過 7 碼的部分捨去", () => {
    const { onChange, input } = type("民國099年03月15日999");
    expect(input.value).toBe("099/03/15");
    expect(onChange).toHaveBeenLastCalledWith("2010-03-15");
  });

  it("帶入既有的西元日期時顯示成民國年", () => {
    render(<RocDateInput value="1990-05-15" />);
    expect((screen.getByPlaceholderText(/民國年/) as HTMLInputElement).value).toBe("079/05/15");
  });

  it("民國前的日期（西元 1911 年以前）無法表示，顯示空白", () => {
    render(<RocDateInput value="1900-01-01" />);
    expect((screen.getByPlaceholderText(/民國年/) as HTMLInputElement).value).toBe("");
  });

  it("外部把值清空時，輸入框跟著清空", () => {
    const { rerender } = render(<RocDateInput value="1990-05-15" />);
    rerender(<RocDateInput value={undefined} />);
    expect((screen.getByPlaceholderText(/民國年/) as HTMLInputElement).value).toBe("");
  });
});
