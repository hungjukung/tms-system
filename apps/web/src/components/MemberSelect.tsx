import { CSSProperties, useMemo, useState } from "react";
import { Select, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { searchMembers } from "../api/households";

interface Props {
  value?: string;
  onChange?: (memberId: string) => void;
  /** 選定/清空信徒時一併回傳姓名，供不需要另外查詢的畫面顯示用（例如尚未送出的暫存項目預覽） */
  onSelectMember?: (member: { id: string; name: string } | undefined) => void;
  style?: CSSProperties;
}

export function MemberSelect({ value, onChange, onSelectMember, style }: Props) {
  const [keyword, setKeyword] = useState("");
  // 選定後 antd 會清掉搜尋字，搜尋結果跟著消失；記住已選的那一位，否則欄位會只剩一串 id
  const [chosen, setChosen] = useState<{ value: string; label: string; name: string } | undefined>();
  const query = useQuery({
    queryKey: ["member-select", keyword],
    queryFn: () => searchMembers(keyword, 1, 20),
    enabled: keyword.length > 0,
  });

  const options = useMemo(
    () =>
      (query.data?.items ?? []).map((m) => ({
        value: m.id,
        label: `${m.name}（${m.phone ?? "無電話"}）`,
        name: m.name,
      })),
    [query.data],
  );
  const shownOptions =
    value && chosen?.value === value && !options.some((o) => o.value === value) ? [chosen, ...options] : options;

  return (
    <Select
      showSearch
      style={style}
      value={value}
      placeholder="輸入姓名或電話搜尋信徒"
      filterOption={false}
      onSearch={setKeyword}
      onChange={(val, option) => {
        onChange?.(val);
        const picked = Array.isArray(option) ? option[0] : option;
        setChosen(val && picked ? { value: val, label: (picked as { label: string }).label, name: (picked as { name: string }).name } : undefined);
        if (!onSelectMember) return;
        const opt = Array.isArray(option) ? option[0] : option;
        onSelectMember(val && opt ? { id: val, name: (opt as { name: string }).name } : undefined);
      }}
      notFoundContent={query.isFetching ? <Spin size="small" /> : "查無資料"}
      options={shownOptions}
    />
  );
}
