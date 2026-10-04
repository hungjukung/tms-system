import { useEffect, useRef, useState } from "react";
import { Input } from "antd";

interface Props {
  /** 西元日期字串 "YYYY-MM-DD"（後端儲存格式，用於農曆/生肖/太歲換算） */
  value?: string;
  onChange?: (value: string | undefined) => void;
}

/** 7 碼民國年月日（XXX/XX/XX）轉西元日期字串，未滿 7 碼視為尚未輸入完成 */
function digitsToIso(digits: string): string | undefined {
  if (digits.length !== 7) return undefined;
  const rocYear = Number(digits.slice(0, 3));
  const month = digits.slice(3, 5);
  const day = digits.slice(5, 7);
  return `${rocYear + 1911}-${month}-${day}`;
}

function isoToDigits(iso?: string): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!match) return "";
  const rocYear = Number(match[1]) - 1911;
  if (rocYear < 0 || rocYear > 999) return "";
  return `${String(rocYear).padStart(3, "0")}${match[2]}${match[3]}`;
}

function formatDigits(digits: string): string {
  if (digits.length > 5) return `${digits.slice(0, 3)}/${digits.slice(3, 5)}/${digits.slice(5)}`;
  if (digits.length > 3) return `${digits.slice(0, 3)}/${digits.slice(3)}`;
  return digits;
}

/** 用鍵盤輸入 7 碼民國年月日（例如 099/03/15），內部自動轉換成西元日期存入表單 */
export function RocDateInput({ value, onChange }: Props) {
  const [digits, setDigits] = useState(() => isoToDigits(value));
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setDigits(isoToDigits(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextDigits = e.target.value.replace(/\D/g, "").slice(0, 7);
    setDigits(nextDigits);
    const next = digitsToIso(nextDigits);
    lastEmitted.current = next;
    onChange?.(next);
  };

  return (
    <Input
      value={formatDigits(digits)}
      onChange={handleChange}
      placeholder="民國年/月/日，例如 099/03/15"
      maxLength={9}
    />
  );
}
