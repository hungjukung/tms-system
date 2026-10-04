import { useState } from "react";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BulkImportMembersResponse, Gender, HouseholdDto, MemberDto, MemberTagType, UserRole } from "@tms/shared";
import {
  createHousehold,
  createMember,
  deleteHousehold,
  deleteMember,
  getHouseholdMembers,
  importMembers,
  listHouseholds,
  searchMembers,
  updateHousehold,
  updateMember,
} from "../api/households";
import { getMemberHistory } from "../api/lantern";
import { getCeremonyMemberHistory } from "../api/ceremony";
import { MemberSelect } from "../components/MemberSelect";
import { RocDateInput } from "../components/RocDateInput";
import { useAuth } from "../context/AuthContext";
import { downloadMemberImportTemplate, parseMemberImportFile } from "../utils/memberImport";

const genderLabel: Record<Gender, string> = {
  [Gender.MALE]: "男",
  [Gender.FEMALE]: "女",
  [Gender.UNKNOWN]: "未填",
};

const tagLabel: Record<MemberTagType, string> = {
  [MemberTagType.GENERAL]: "一般信徒",
  [MemberTagType.LEGAL_MEMBER]: "合法信徒",
};

export function HouseholdsPage() {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const isDirector = user?.role === UserRole.DIRECTOR;
  const isDataEntry = user?.role === UserRole.DATA_ENTRY;
  // 資料建檔人員與報名櫃檯人員都只能新增信徒/戶籍資料，不能編輯或刪除既有資料
  const isViewOnlyHousehold = isDataEntry || user?.role === UserRole.REGISTRAR;
  const [keyword, setKeyword] = useState("");
  const [householdKeyword, setHouseholdKeyword] = useState("");
  const [householdModalOpen, setHouseholdModalOpen] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberDto | null>(null);
  const [selectedMember, setSelectedMember] = useState<MemberDto | null>(null);
  const [selectedHousehold, setSelectedHousehold] = useState<HouseholdDto | null>(null);
  const [addMemberSelection, setAddMemberSelection] = useState<string | undefined>();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; member: MemberDto } | null>(null);
  const [importResult, setImportResult] = useState<BulkImportMembersResponse | null>(null);
  const [householdForm] = Form.useForm();
  const [memberForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [householdEditForm] = Form.useForm();

  const householdsQuery = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const filteredHouseholds = (householdsQuery.data ?? []).filter(
    (h) => !householdKeyword || h.address.includes(householdKeyword) || (h.phone ?? "").includes(householdKeyword),
  );
  const membersQuery = useQuery({
    queryKey: ["members", keyword],
    queryFn: () => searchMembers(keyword),
  });
  const householdMembersQuery = useQuery({
    queryKey: ["household-members", selectedHousehold?.id],
    queryFn: () => getHouseholdMembers(selectedHousehold!.id),
    enabled: !!selectedHousehold,
  });
  const historyQuery = useQuery({
    queryKey: ["member-history", selectedMember?.id],
    queryFn: () => getMemberHistory(selectedMember!.id),
    enabled: !!selectedMember,
  });
  const ceremonyHistoryQuery = useQuery({
    queryKey: ["member-ceremony-history", selectedMember?.id],
    queryFn: () => getCeremonyMemberHistory(selectedMember!.id),
    enabled: !!selectedMember,
  });
  const combinedHistory = [...(historyQuery.data ?? []), ...(ceremonyHistoryQuery.data ?? [])].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  // 點選信徒時，一併查出同一戶籍內的其他成員，供在信徒詳情視窗直接看到整戶名單、互相切換查看
  const memberHouseholdQuery = useQuery({
    queryKey: ["household-members", selectedMember?.householdId],
    queryFn: () => getHouseholdMembers(selectedMember!.householdId),
    enabled: !!selectedMember,
  });

  const createHouseholdMutation = useMutation({
    mutationFn: createHousehold,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["households"] });
      setHouseholdModalOpen(false);
      householdForm.resetFields();
    },
  });

  const updateHouseholdMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Parameters<typeof updateHousehold>[1] }) => updateHousehold(id, dto),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["households"] });
      setSelectedHousehold(updated);
      message.success("已更新戶籍資料");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "更新失敗，請重試");
    },
  });

  const deleteHouseholdMutation = useMutation({
    mutationFn: deleteHousehold,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["households"] });
      setSelectedHousehold(null);
      message.success("已刪除戶籍");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "刪除失敗，請重試");
    },
  });

  const openHouseholdDrawer = (household: HouseholdDto) => {
    householdEditForm.setFieldsValue({ address: household.address, phone: household.phone ?? undefined });
    setAddMemberSelection(undefined);
    setSelectedHousehold(household);
  };

  const addMemberToHouseholdMutation = useMutation({
    mutationFn: ({ memberId, householdId }: { memberId: string; householdId: string }) =>
      updateMember(memberId, { householdId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["household-members"] });
      queryClient.invalidateQueries({ queryKey: ["households"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      setAddMemberSelection(undefined);
      message.success("已將信徒加入本戶");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "加入失敗，請重試");
    },
  });

  const createMemberMutation = useMutation({
    mutationFn: createMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["household-members"] });
      queryClient.invalidateQueries({ queryKey: ["households"] });
      setMemberModalOpen(false);
      memberForm.resetFields();
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Parameters<typeof updateMember>[1] }) => updateMember(id, dto),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["household-members"] });
      if (selectedMember?.id === updated.id) setSelectedMember(updated);
      setEditModalOpen(false);
      setEditingMember(null);
      message.success("已更新信徒資料");
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? "更新失敗，請重試");
    },
  });

  const openEditModal = (member: MemberDto) => {
    editForm.setFieldsValue({
      name: member.name,
      phone: member.phone ?? undefined,
      address: member.address ?? undefined,
      gender: member.gender,
      birthDateSolar: member.birthDateSolar ?? undefined,
      birthDateLunar: member.birthDateLunar ?? undefined,
      tags: member.tags,
    });
    setEditingMember(member);
    setEditModalOpen(true);
  };

  const deleteMemberMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => deleteMember(id, force),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["household-members"] });
      queryClient.invalidateQueries({ queryKey: ["households"] });
      if (selectedMember?.id === variables.id) setSelectedMember(null);
      message.success("已刪除信徒");
    },
    onError: (err: any, variables) => {
      const historyCount = err?.response?.data?.historyCount;
      if (err?.response?.status === 409 && typeof historyCount === "number" && !variables.force) {
        modal.confirm({
          title: "此信徒已有歷史紀錄",
          content: `已有 ${historyCount} 筆捐款/點燈/活動報名紀錄。再次確認後將刪除此信徒資料（收據金額仍會保留在財務紀錄中，但信眾姓名之後會顯示為空）。確定要刪除嗎？`,
          okText: "確定刪除",
          okButtonProps: { danger: true },
          cancelText: "取消",
          onOk: () => deleteMemberMutation.mutate({ id: variables.id, force: true }),
        });
        return;
      }
      message.error(err?.response?.data?.message ?? "刪除失敗，請重試");
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const rows = await parseMemberImportFile(file);
      if (rows.length === 0) throw new Error("檔案內容是空的，請確認格式");
      return importMembers(rows);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["households"] });
      setImportResult(result);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message ?? err?.message ?? "匯入失敗，請確認檔案格式");
    },
  });

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Space wrap>
          <Input.Search
            placeholder="搜尋信徒姓名或電話"
            allowClear
            style={{ width: 320 }}
            onSearch={setKeyword}
          />
          <Button onClick={() => setHouseholdModalOpen(true)}>新增戶籍</Button>
          <Button type="primary" onClick={() => setMemberModalOpen(true)}>
            新增信徒
          </Button>
          <Upload
            showUploadList={false}
            accept=".xlsx,.xls"
            beforeUpload={(file) => {
              importMutation.mutate(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={importMutation.isPending}>
              一鍵匯入信徒
            </Button>
          </Upload>
          <Button onClick={downloadMemberImportTemplate}>下載匯入範本</Button>
        </Space>
      </Card>

      <Card title="信徒列表">
        <Table
          rowKey="id"
          loading={membersQuery.isLoading}
          dataSource={membersQuery.data?.items ?? []}
          onRow={(record) => ({
            onClick: () => setSelectedMember(record),
            onContextMenu: (event) => {
              event.preventDefault();
              if (isViewOnlyHousehold) return;
              setContextMenu({ x: event.clientX, y: event.clientY, member: record });
            },
          })}
          columns={[
            { title: "姓名", dataIndex: "name" },
            { title: "電話", dataIndex: "phone" },
            { title: "地址", dataIndex: "address", render: (v: string | null) => v ?? "-" },
            { title: "性別", dataIndex: "gender", render: (g: Gender) => genderLabel[g] },
            { title: "生肖", dataIndex: "zodiac" },
            {
              title: "太歲提醒",
              dataIndex: "isZodiacClashYear",
              render: (v: boolean) => (v ? <Tag color="red">今年犯太歲</Tag> : null),
            },
            {
              title: "標籤",
              dataIndex: "tags",
              render: (tags: MemberTagType[]) => tags.map((t) => <Tag key={t}>{tagLabel[t]}</Tag>),
            },
            ...(isDirector
              ? [
                  {
                    title: "操作",
                    render: (_: unknown, record: MemberDto) => (
                      <div onClick={(e) => e.stopPropagation()}>
                        <Popconfirm
                          title="確定要刪除此信徒嗎？"
                          description="若此信徒已有捐款/點燈/活動紀錄，會再跟你確認一次"
                          okText="刪除"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={() => deleteMemberMutation.mutate({ id: record.id, force: false })}
                        >
                          <Button danger size="small" loading={deleteMemberMutation.isPending}>
                            刪除
                          </Button>
                        </Popconfirm>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
          pagination={{ total: membersQuery.data?.total, pageSize: 20 }}
        />
      </Card>

      <Card
        title="戶籍列表"
        extra={
          <Input.Search
            placeholder="搜尋戶籍地址或電話"
            allowClear
            style={{ width: 260 }}
            onSearch={setHouseholdKeyword}
            onChange={(e) => !e.target.value && setHouseholdKeyword("")}
          />
        }
      >
        <Table
          rowKey="id"
          loading={householdsQuery.isLoading}
          dataSource={filteredHouseholds}
          onRow={(record) => ({ onClick: () => openHouseholdDrawer(record) })}
          columns={[
            { title: "地址", dataIndex: "address" },
            { title: "電話", dataIndex: "phone", render: (v: string | null) => v ?? "-" },
            { title: "信徒人數", dataIndex: "memberCount" },
            { title: "建立時間", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleDateString("zh-TW") },
            {
              title: "操作",
              render: (_: unknown, record: HouseholdDto) => (
                <div onClick={(e) => e.stopPropagation()}>
                  <Button size="small" onClick={() => openHouseholdDrawer(record)}>
                    {isViewOnlyHousehold ? "查看" : "編輯"}
                  </Button>
                </div>
              ),
            },
          ]}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      {contextMenu && (
        <Dropdown
          open
          onOpenChange={(open) => {
            if (!open) setContextMenu(null);
          }}
          menu={{
            items: [
              ...(isViewOnlyHousehold ? [] : [{ key: "edit", label: "編輯個人資料" }]),
              ...(isDirector ? [{ key: "delete", label: "刪除信徒", danger: true }] : []),
            ],
            onClick: ({ key }) => {
              const member = contextMenu.member;
              setContextMenu(null);
              if (key === "edit") {
                openEditModal(member);
              } else if (key === "delete") {
                modal.confirm({
                  title: "確定要刪除此信徒嗎？",
                  content: "若此信徒已有捐款/點燈/活動紀錄，會再跟你確認一次",
                  okText: "刪除",
                  okButtonProps: { danger: true },
                  cancelText: "取消",
                  onOk: () => deleteMemberMutation.mutate({ id: member.id, force: false }),
                });
              }
            },
          }}
        >
          <div style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, width: 1, height: 1 }} />
        </Dropdown>
      )}

      <Modal
        title="新增戶籍"
        open={householdModalOpen}
        onCancel={() => setHouseholdModalOpen(false)}
        onOk={() => householdForm.submit()}
        confirmLoading={createHouseholdMutation.isPending}
      >
        <Form form={householdForm} layout="vertical" onFinish={(v) => createHouseholdMutation.mutate(v)}>
          <Form.Item label="地址" name="address" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="市話" name="phone">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新增信徒"
        open={memberModalOpen}
        onCancel={() => setMemberModalOpen(false)}
        onOk={() => memberForm.submit()}
        confirmLoading={createMemberMutation.isPending}
      >
        <Form form={memberForm} layout="vertical" onFinish={(v) => createMemberMutation.mutate(v)}>
          <Form.Item
            label="戶籍地址"
            name="householdAddress"
            rules={[{ required: true }]}
            extra="跟現有戶籍地址完全相同會自動歸入該戶，否則會自動建立新戶籍"
          >
            <AutoComplete
              options={[...new Set((householdsQuery.data ?? []).map((h) => h.address))].map((address) => ({
                value: address,
              }))}
              filterOption={(input, option) => (option?.value ?? "").includes(input)}
              placeholder="輸入戶籍地址"
            />
          </Form.Item>
          <Form.Item label="姓名" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="電話" name="phone">
            <Input />
          </Form.Item>
          <Form.Item label="地址（若與戶籍地址不同才需填寫）" name="address">
            <Input />
          </Form.Item>
          <Form.Item label="性別" name="gender" initialValue={Gender.UNKNOWN}>
            <Radio.Group>
              <Radio.Button value={Gender.MALE}>男</Radio.Button>
              <Radio.Button value={Gender.FEMALE}>女</Radio.Button>
              <Radio.Button value={Gender.UNKNOWN}>未填</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="生日（國曆，用於自動推算生肖與太歲）" name="birthDateSolar">
            <RocDateInput />
          </Form.Item>
          <Form.Item label="農曆生日（選填，留空則依國曆生日自動換算）" name="birthDateLunar">
            <Input placeholder="例如：庚寅年 正月三十" />
          </Form.Item>
          <Form.Item label="標籤" name="tags">
            <Select
              mode="multiple"
              options={Object.entries(tagLabel).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={
          <Space>
            {selectedMember?.name}
            {selectedMember && !isViewOnlyHousehold && (
              <Button size="small" onClick={() => openEditModal(selectedMember)}>
                編輯
              </Button>
            )}
          </Space>
        }
        open={!!selectedMember}
        onClose={() => setSelectedMember(null)}
        width={480}
      >
        {selectedMember && (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            {selectedMember.isZodiacClashYear && (
              <Alert type="warning" showIcon message="今年犯太歲，建議推薦安太歲或祭改" />
            )}
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="電話">{selectedMember.phone ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="地址">{selectedMember.address ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="性別">{genderLabel[selectedMember.gender]}</Descriptions.Item>
              <Descriptions.Item label="國曆生日">{selectedMember.birthDateSolar ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="農曆生日">{selectedMember.birthDateLunar ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="生肖">{selectedMember.zodiac ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="標籤">
                {selectedMember.tags.map((t) => (
                  <Tag key={t}>{tagLabel[t]}</Tag>
                ))}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5}>
              戶內成員（共 {memberHouseholdQuery.data?.length ?? 0} 人）
            </Typography.Title>
            <List
              loading={memberHouseholdQuery.isLoading}
              dataSource={memberHouseholdQuery.data ?? []}
              renderItem={(m) => (
                <List.Item
                  actions={
                    m.id === selectedMember.id
                      ? [<Tag color="blue">本人</Tag>]
                      : [
                          <Button size="small" onClick={() => setSelectedMember(m)}>
                            查看
                          </Button>,
                        ]
                  }
                >
                  <List.Item.Meta title={m.name} description={m.phone ?? "無電話"} />
                </List.Item>
              )}
            />
            <Typography.Title level={5}>歷史捐款 / 點燈 / 活動紀錄</Typography.Title>
            <List
              loading={historyQuery.isLoading || ceremonyHistoryQuery.isLoading}
              dataSource={combinedHistory}
              locale={{ emptyText: "尚無紀錄" }}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={item.description}
                    description={new Date(item.occurredAt).toLocaleString("zh-TW")}
                  />
                  <div>NT$ {item.amount.toLocaleString()}</div>
                </List.Item>
              )}
            />
          </Space>
        )}
      </Drawer>

      <Drawer
        title={`戶籍：${selectedHousehold?.address ?? ""}`}
        open={!!selectedHousehold}
        onClose={() => setSelectedHousehold(null)}
        width={560}
      >
        {selectedHousehold && (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            {isViewOnlyHousehold ? (
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="地址">{selectedHousehold.address}</Descriptions.Item>
                <Descriptions.Item label="市話">{selectedHousehold.phone ?? "-"}</Descriptions.Item>
              </Descriptions>
            ) : (
              <Form
                form={householdEditForm}
                layout="vertical"
                onFinish={(values) => updateHouseholdMutation.mutate({ id: selectedHousehold.id, dto: values })}
              >
                <Form.Item label="地址" name="address" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item label="市話" name="phone">
                  <Input />
                </Form.Item>
                <Space style={{ width: "100%", justifyContent: "flex-end" }}>
                  {isDirector && (
                    <Popconfirm
                      title="確定要刪除此戶籍嗎？"
                      description="戶籍必須先淨空（無任何信徒）才能刪除"
                      okText="刪除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => deleteHouseholdMutation.mutate(selectedHousehold.id)}
                    >
                      <Button danger loading={deleteHouseholdMutation.isPending}>
                        刪除戶籍
                      </Button>
                    </Popconfirm>
                  )}
                  <Button type="primary" htmlType="submit" loading={updateHouseholdMutation.isPending}>
                    儲存
                  </Button>
                </Space>
              </Form>
            )}

            <Typography.Title level={5}>戶內信徒（{householdMembersQuery.data?.length ?? 0} 人）</Typography.Title>
            {!isViewOnlyHousehold && (
              <Space.Compact style={{ width: "100%" }}>
                <div style={{ flex: 1 }}>
                  <MemberSelect value={addMemberSelection} onChange={setAddMemberSelection} />
                </div>
                <Button
                  type="primary"
                  disabled={!addMemberSelection}
                  loading={addMemberToHouseholdMutation.isPending}
                  onClick={() =>
                    addMemberSelection &&
                    addMemberToHouseholdMutation.mutate({ memberId: addMemberSelection, householdId: selectedHousehold.id })
                  }
                >
                  新增成員
                </Button>
              </Space.Compact>
            )}
            <Table
              rowKey="id"
              size="small"
              loading={householdMembersQuery.isLoading}
              dataSource={householdMembersQuery.data ?? []}
              pagination={false}
              columns={[
                { title: "姓名", dataIndex: "name" },
                { title: "電話", dataIndex: "phone", render: (v: string | null) => v ?? "-" },
                { title: "性別", dataIndex: "gender", render: (g: Gender) => genderLabel[g] },
                ...(isViewOnlyHousehold
                  ? []
                  : [
                      {
                        title: "操作",
                        render: (_: unknown, record: MemberDto) => (
                          <Space>
                            <Button size="small" onClick={() => openEditModal(record)}>
                              編輯
                            </Button>
                            {isDirector && (
                              <Popconfirm
                                title="確定要刪除此信徒嗎？"
                                description="若此信徒已有捐款/點燈/活動紀錄，會再跟你確認一次"
                                okText="刪除"
                                okButtonProps={{ danger: true }}
                                cancelText="取消"
                                onConfirm={() => deleteMemberMutation.mutate({ id: record.id, force: false })}
                              >
                                <Button danger size="small" loading={deleteMemberMutation.isPending}>
                                  刪除
                                </Button>
                              </Popconfirm>
                            )}
                          </Space>
                        ),
                      },
                    ]),
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Modal
        title={`編輯信徒：${editingMember?.name ?? ""}`}
        open={editModalOpen}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingMember(null);
        }}
        onOk={() => editForm.submit()}
        confirmLoading={updateMemberMutation.isPending}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => editingMember && updateMemberMutation.mutate({ id: editingMember.id, dto: values })}
        >
          <Form.Item label="姓名" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="電話" name="phone">
            <Input />
          </Form.Item>
          <Form.Item label="地址（若與戶籍地址不同才需填寫）" name="address">
            <Input />
          </Form.Item>
          <Form.Item label="性別" name="gender">
            <Radio.Group>
              <Radio.Button value={Gender.MALE}>男</Radio.Button>
              <Radio.Button value={Gender.FEMALE}>女</Radio.Button>
              <Radio.Button value={Gender.UNKNOWN}>未填</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="生日（國曆，用於自動推算生肖與太歲）" name="birthDateSolar">
            <RocDateInput />
          </Form.Item>
          <Form.Item label="農曆生日（選填，留空則依國曆生日自動換算）" name="birthDateLunar">
            <Input placeholder="例如：庚寅年 正月三十" />
          </Form.Item>
          <Form.Item label="標籤" name="tags">
            <Select
              mode="multiple"
              options={Object.entries(tagLabel).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="匯入結果"
        open={!!importResult}
        onCancel={() => setImportResult(null)}
        footer={
          <Button type="primary" onClick={() => setImportResult(null)}>
            關閉
          </Button>
        }
      >
        {importResult && (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Alert
              type={importResult.failedRows.length > 0 ? "warning" : "success"}
              showIcon
              message={`成功匯入 ${importResult.successCount} 筆信徒資料`}
            />
            {importResult.failedRows.length > 0 && (
              <>
                <Typography.Text type="secondary">
                  以下 {importResult.failedRows.length} 列未匯入，請修正檔案內容後重新匯入：
                </Typography.Text>
                <List
                  size="small"
                  dataSource={importResult.failedRows}
                  renderItem={(row) => (
                    <List.Item>
                      第 {row.rowNumber} 列（{row.name}）：{row.message}
                    </List.Item>
                  )}
                />
              </>
            )}
          </Space>
        )}
      </Modal>
    </Space>
  );
}
