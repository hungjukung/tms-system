import { useMemo, useState } from "react";
import { Select, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { searchHouseholds } from "../api/households";

interface Props {
  value?: string;
  onChange?: (householdId: string) => void;
}

/** 整戶報名等流程使用：透過地址或戶內任一成員姓名搜尋戶籍 */
export function HouseholdSelect({ value, onChange }: Props) {
  const [keyword, setKeyword] = useState("");
  const query = useQuery({
    queryKey: ["household-select", keyword],
    queryFn: () => searchHouseholds(keyword, 1, 20),
    enabled: keyword.length > 0,
  });

  const options = useMemo(
    () => (query.data?.items ?? []).map((h) => ({ value: h.id, label: `${h.address}${h.phone ? `（${h.phone}）` : ""}` })),
    [query.data],
  );

  return (
    <Select
      showSearch
      value={value}
      placeholder="輸入地址或戶內成員姓名搜尋"
      filterOption={false}
      onSearch={setKeyword}
      onChange={onChange}
      notFoundContent={query.isFetching ? <Spin size="small" /> : "查無資料"}
      options={options}
    />
  );
}
