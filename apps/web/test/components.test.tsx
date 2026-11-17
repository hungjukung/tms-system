import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CeremonySeatDto, isPilgrimageBusSeat } from "@tms/shared";
import { BusSeatMap, busSeatLabel } from "../src/components/BusSeatMap";
import { RocDateInput } from "../src/components/RocDateInput";

/** 依遊覽車配置產生 40 個座位；taken 是「座位流水號 → 姓名」 */
function busSeats(taken: Record<number, string> = {}): CeremonySeatDto[] {
  return Array.from({ length: 48 }, (_, i) => i + 1)
    .filter(isPilgrimageBusSeat)
    .map((seatIndex) => ({
      seatIndex,
      tableNumber: Math.floor((seatIndex - 1) / 4) + 1,
      seatInTable: ((seatIndex - 1) % 4) + 1,
      status: taken[seatIndex] !== undefined ? ("TAKEN" as const) : ("EMPTY" as const),
      participantName: taken[seatIndex],
    }));
}

describe("busSeatLabel", () => {
  it("第幾排第幾號", () => {
    expect(busSeatLabel({ tableNumber: 3, seatInTable: 2 })).toBe("3排2號");
    expect(busSeatLabel({ tableNumber: 12, seatInTable: 4 })).toBe("12排4號");
  });
});

describe("BusSeatMap 遊覽車座位圖", () => {
  it("畫出 40 個座位；門的位置（例如 1 排 3 號）沒有座位", () => {
    render(<BusSeatMap seats={busSeats()} onSeatClick={() => undefined} />);
    expect(screen.getAllByTitle(/排\d號/)).toHaveLength(40);
    expect(screen.queryByTitle(/^1排3號/)).toBeNull();
    expect(screen.queryByTitle(/^8排4號/)).toBeNull();
    expect(screen.getByTitle("3排3號（空位）")).toBeInTheDocument();
  });

  it("標示前門、後門、安全門，左右兩側都有排數", () => {
    render(<BusSeatMap seats={busSeats()} />);
    expect(screen.getByText("前門")).toBeInTheDocument();
    expect(screen.getByText("後門")).toBeInTheDocument();
    expect(screen.getByText("安全門")).toBeInTheDocument();
    // 第 3 排左右各標一次；第 1 排右邊是門，只有左邊標
    expect(screen.getAllByText("三排")).toHaveLength(2);
    expect(screen.getAllByText("一排")).toHaveLength(1);
    expect(screen.getAllByText("十二排")).toHaveLength(2);
  });

  it("已有人的座位顯示姓名、變色，而且點了沒有反應", () => {
    const onSeatClick = vi.fn();
    render(<BusSeatMap seats={busSeats({ 1: "王小明" })} onSeatClick={onSeatClick} />);
    const taken = screen.getByTitle("1排1號：王小明");
    expect(taken).toHaveTextContent("王小明");
    expect(taken).toHaveStyle({ background: "rgb(232, 160, 170)", cursor: "not-allowed" });
    fireEvent.click(taken);
    expect(onSeatClick).not.toHaveBeenCalled();
  });

  it("已有人但沒有姓名：提示文字顯示「已有人」", () => {
    render(<BusSeatMap seats={busSeats({ 2: "" })} />);
    expect(screen.getByTitle("1排2號：已有人")).toBeInTheDocument();
  });

  it("點空位會回傳那個座位", () => {
    const onSeatClick = vi.fn();
    render(<BusSeatMap seats={busSeats()} onSeatClick={onSeatClick} />);
    fireEvent.click(screen.getByTitle("3排2號（空位）"));
    expect(onSeatClick).toHaveBeenCalledTimes(1);
    expect(onSeatClick.mock.calls[0][0]).toMatchObject({ seatIndex: 10, tableNumber: 3, seatInTable: 2 });
  });

  it("本次選取的座位變成藍色，仍然可以再點一次（用來取消）", () => {
    const onSeatClick = vi.fn();
    render(<BusSeatMap seats={busSeats()} chosenSeatIndexes={[10]} onSeatClick={onSeatClick} />);
    const chosen = screen.getByTitle("3排2號（已選）");
    expect(chosen).toHaveStyle({ background: "rgb(22, 119, 255)", cursor: "pointer" });
    fireEvent.click(chosen);
    expect(onSeatClick).toHaveBeenCalledTimes(1);
  });

  it("唯讀模式（沒有 onSeatClick）：不顯示「本次選取」圖例，游標是一般樣式", () => {
    render(<BusSeatMap seats={busSeats()} />);
    expect(screen.queryByText(/本次選取/)).toBeNull();
    expect(screen.getByTitle("3排2號（空位）")).toHaveStyle({ cursor: "default" });
  });

  it("可選位模式顯示三種圖例", () => {
    render(<BusSeatMap seats={busSeats()} onSeatClick={() => undefined} />);
    expect(screen.getByText(/空位/)).toBeInTheDocument();
    expect(screen.getByText(/已有人/)).toBeInTheDocument();
    expect(screen.getByText(/本次選取/)).toBeInTheDocument();
  });

  it("還沒載入座位資料（空陣列）也不會出錯", () => {
    render(<BusSeatMap seats={[]} />);
    expect(screen.queryAllByTitle(/排\d號/)).toHaveLength(0);
    expect(screen.getByText("前門")).toBeInTheDocument();
  });
});

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
