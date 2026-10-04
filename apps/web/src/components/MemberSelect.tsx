import { useMemo, useState } from "react";
import { Select, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { searchMembers } from "../api/households";

interface Props {
  value?: string;
  onChange?: (memberId: string) => void;
  /** 選定/清空信徒時一併回傳姓名，供不需要另外查詢的畫面顯示用（例如尚未送出的暫存項目預覽） */
  onSelectMember?: (member: { id: string; name: string } | undefined) => void;
}

export function MemberSelect({ value, onChange, onSelectMember }: Props) {
  const [keyword, setKeyword] = useState("");
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

  return (
    <Select
      showSearch
      value={value}
      placeholder="輸入姓名或電話搜尋信徒"
      filterOption={false}
      onSearch={setKeyword}
      onChange={(val, option) => {
        onChange?.(val);
        if (!onSelectMember) return;
        const opt = Array.isArray(option) ? option[0] : option;
        onSelectMember(val && opt ? { id: val, name: (opt as { name: string }).name } : undefined);
      }}
      notFoundContent={query.isFetching ? <Spin size="small" /> : "查無資料"}
      options={options}
    />
  );
}
