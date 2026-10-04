import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Like, Repository } from "typeorm";
import { BulkImportMembersResponse, Gender, HouseholdDto, MemberDto, MemberTagType } from "@tms/shared";
import { Household } from "./entities/household.entity";
import { Member } from "./entities/member.entity";
import { CreateHouseholdDto } from "./dto/create-household.dto";
import { UpdateHouseholdDto } from "./dto/update-household.dto";
import { CreateMemberDto } from "./dto/create-member.dto";
import { UpdateMemberDto } from "./dto/update-member.dto";
import { BulkImportMemberRowDto } from "./dto/bulk-import-members.dto";
import { LunarService } from "./lunar.service";

const TAG_LABEL_TO_ENUM: Record<string, MemberTagType> = {
  一般信徒: MemberTagType.GENERAL,
  合法信徒: MemberTagType.LEGAL_MEMBER,
};

@Injectable()
export class HouseholdService {
  constructor(
    @InjectRepository(Household) private readonly householdRepo: Repository<Household>,
    @InjectRepository(Member) private readonly memberRepo: Repository<Member>,
    private readonly lunarService: LunarService,
  ) {}

  async createHousehold(dto: CreateHouseholdDto): Promise<HouseholdDto> {
    const household = this.householdRepo.create({
      address: dto.address,
      phone: dto.phone ?? null,
    });
    const saved = await this.householdRepo.save(household);
    return this.toHouseholdDto(saved);
  }

  async listHouseholds(): Promise<HouseholdDto[]> {
    const households = await this.householdRepo.find({ order: { createdAt: "DESC" } });
    if (households.length === 0) return [];

    const counts = await this.memberRepo
      .createQueryBuilder("member")
      .select("member.householdId", "householdId")
      .addSelect("COUNT(*)", "count")
      .groupBy("member.householdId")
      .getRawMany<{ householdId: string; count: string }>();
    const countByHouseholdId = new Map(counts.map((c) => [c.householdId, Number(c.count)]));

    return households.map((h) => ({ ...this.toHouseholdDto(h), memberCount: countByHouseholdId.get(h.id) ?? 0 }));
  }

  /** 戶籍列表點選編輯使用：更新地址／電話（不含成員本身，成員各自透過 updateMember 編輯） */
  async updateHousehold(id: string, dto: UpdateHouseholdDto): Promise<HouseholdDto> {
    const household = await this.householdRepo.findOne({ where: { id } });
    if (!household) throw new NotFoundException("找不到戶籍資料");

    if (dto.address !== undefined) household.address = dto.address;
    if (dto.phone !== undefined) household.phone = dto.phone || null;

    const saved = await this.householdRepo.save(household);
    return this.toHouseholdDto(saved);
  }

  /** 戶籍必須先淨空（無任何信徒）才能刪除，避免不小心連坐刪掉整戶信徒的歷史紀錄關聯 */
  async deleteHousehold(id: string): Promise<void> {
    const household = await this.householdRepo.findOne({ where: { id } });
    if (!household) throw new NotFoundException("找不到戶籍資料");

    const memberCount = await this.memberRepo.count({ where: { householdId: id } });
    if (memberCount > 0) {
      throw new ConflictException(`此戶籍下還有 ${memberCount} 位信徒，請先移除或轉移所有成員後再刪除戶籍`);
    }

    await this.householdRepo.remove(household);
  }

  /** 新增信徒：戶籍地址跟現有戶籍完全相同就自動歸入該戶，否則自動新增戶籍（跟一鍵匯入的歸戶邏輯一致） */
  async createMember(dto: CreateMemberDto): Promise<MemberDto> {
    const householdAddress = dto.householdAddress.trim();
    let household = await this.householdRepo.findOne({ where: { address: householdAddress } });
    if (!household) {
      household = await this.householdRepo.save(
        this.householdRepo.create({ address: householdAddress, phone: null }),
      );
    }

    let birthDateLunar: string | null = null;
    let zodiac: string | null = null;
    if (dto.birthDateSolar) {
      const converted = this.lunarService.convertSolarToLunar(dto.birthDateSolar);
      birthDateLunar = converted.lunarDateText;
      zodiac = converted.zodiac;
    }
    // 農曆生日欄位有手動填寫時以此為準，覆蓋掉依國曆自動換算的結果（供只知道農曆生日、或需手動修正換算結果時使用）
    if (dto.birthDateLunar) birthDateLunar = dto.birthDateLunar;

    const member = this.memberRepo.create({
      householdId: household.id,
      name: dto.name,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      gender: dto.gender,
      birthDateSolar: dto.birthDateSolar ?? null,
      birthDateLunar,
      zodiac,
      tags: dto.tags ?? [],
    });
    const saved = await this.memberRepo.save(member);

    await this.recomputeHouseholdHead(household.id);

    return this.toMemberDto(saved);
  }

  /** 編輯信徒個人資料；提供 householdId 時會將信徒轉移到另一戶（供「新增成員」搜尋既有信徒加入本戶使用） */
  async updateMember(id: string, dto: UpdateMemberDto): Promise<MemberDto> {
    const member = await this.memberRepo.findOne({ where: { id } });
    if (!member) {
      throw new NotFoundException("找不到信徒資料");
    }

    const oldHouseholdId = member.householdId;
    let householdChanged = false;

    if (dto.householdId !== undefined && dto.householdId !== member.householdId) {
      const targetHousehold = await this.householdRepo.findOne({ where: { id: dto.householdId } });
      if (!targetHousehold) throw new NotFoundException("找不到目標戶籍");
      member.householdId = dto.householdId;
      householdChanged = true;
    }

    if (dto.name !== undefined) member.name = dto.name;
    if (dto.phone !== undefined) member.phone = dto.phone || null;
    if (dto.address !== undefined) member.address = dto.address || null;
    if (dto.gender !== undefined) member.gender = dto.gender;
    if (dto.tags !== undefined) member.tags = dto.tags;

    if (dto.birthDateSolar !== undefined) {
      member.birthDateSolar = dto.birthDateSolar;
      const converted = this.lunarService.convertSolarToLunar(dto.birthDateSolar);
      member.birthDateLunar = converted.lunarDateText;
      member.zodiac = converted.zodiac;
    }
    // 農曆生日欄位有手動填寫時以此為準，覆蓋掉依國曆自動換算的結果（供只知道農曆生日、或需手動修正換算結果時使用）
    if (dto.birthDateLunar !== undefined) member.birthDateLunar = dto.birthDateLunar || null;

    const saved = await this.memberRepo.save(member);

    if (householdChanged) {
      await this.recomputeHouseholdHead(oldHouseholdId);
      await this.recomputeHouseholdHead(saved.householdId);
    }

    return this.toMemberDto(saved);
  }

  /**
   * 戶長歸屬邏輯：戶內生日最早（年紀最長）的信徒自動成為戶長；
   * 若戶內沒人填生日，維持原戶長（若仍在戶內），否則以最早建檔的信徒暫代。
   * 在新增／編輯轉戶／刪除信徒後都要重新計算，確保戶長始終反映目前戶內最年長者。
   */
  /** manager 提供時（例如一鍵匯入的交易內）改用該交易的 repository，確保能看到同一交易內尚未提交的異動 */
  private async recomputeHouseholdHead(householdId: string, manager?: EntityManager): Promise<void> {
    const householdRepo = manager ? manager.getRepository(Household) : this.householdRepo;
    const memberRepo = manager ? manager.getRepository(Member) : this.memberRepo;

    const household = await householdRepo.findOne({ where: { id: householdId } });
    if (!household) return;

    const members = await memberRepo.find({ where: { householdId } });
    if (members.length === 0) {
      if (household.headMemberId !== null) {
        household.headMemberId = null;
        await householdRepo.save(household);
      }
      return;
    }

    const withBirthdate = members.filter((m) => m.birthDateSolar);
    let head: Member;
    if (withBirthdate.length > 0) {
      head = withBirthdate.reduce((oldest, m) => (m.birthDateSolar! < oldest.birthDateSolar! ? m : oldest));
    } else {
      head =
        members.find((m) => m.id === household.headMemberId) ??
        members.reduce((first, m) => (m.createdAt < first.createdAt ? m : first));
    }

    if (household.headMemberId !== head.id) {
      household.headMemberId = head.id;
      await householdRepo.save(household);
    }
  }

  /**
   * 一鍵匯入信徒資料：所有列都會建立（姓名/地址空白也直接留空建立，不擋下）；
   * 生日欄位若無法辨識（格式看不懂、或換算後是不存在的日期如非閏年 2/29）就直接跳過該欄位、留空，
   * 不會因此擋下整筆信徒資料，只有整批寫入過程中真的發生未預期的資料庫錯誤時才會整批回滾。
   * 歸戶分組優先序：有填「戶號」的話以戶號分組（即使地址欄文字略有差異也視為同一戶）；
   * 沒有戶號才回退用戶籍地址文字比對。分組鍵找不到既有戶籍時，會以該列的地址文字新增戶籍。
   */
  async importMembers(rows: BulkImportMemberRowDto[]): Promise<BulkImportMembersResponse> {
    try {
      const successCount = await this.memberRepo.manager.transaction(async (manager) => {
        const householdRepo = manager.getRepository(Household);
        const memberRepo = manager.getRepository(Member);
        const householdIdByGroupKey = new Map<string, string>();

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const name = row.name?.trim() ?? "";
          const householdAddress = row.householdAddress?.trim() ?? "";
          const birthDateSolar = this.parseImportBirthDate(row.birthDateSolar);

          // 戶籍地址空白時不與既有戶籍比對合併（避免多筆地址空白的資料被誤判成同一戶），
          // 除非匯入檔案有另外填「戶籍分組代碼」明確指定要歸在一起
          const groupKey = row.householdKey?.trim() || householdAddress || `__blank_${i}__`;
          let householdId = householdIdByGroupKey.get(groupKey);
          if (!householdId) {
            let household = householdAddress
              ? await householdRepo.findOne({ where: { address: householdAddress } })
              : null;
            if (!household) {
              household = await householdRepo.save(
                householdRepo.create({ address: householdAddress, phone: row.householdPhone?.trim() || null }),
              );
            }
            householdId = household.id;
            householdIdByGroupKey.set(groupKey, householdId);
          }

          let birthDateLunar: string | null = null;
          let zodiac: string | null = null;
          if (birthDateSolar) {
            const converted = this.lunarService.convertSolarToLunar(birthDateSolar);
            birthDateLunar = converted.lunarDateText;
            zodiac = converted.zodiac;
          }

          const member = memberRepo.create({
            householdId,
            name,
            phone: row.phone?.trim() || null,
            // 信徒本人地址：若匯入檔案有另外填「信徒地址」欄位就用那個，否則預設沿用戶籍地址，
            // 確保只有單一地址欄位的舊格式資料表，地址也會確實存進信徒資料本身（不會留空）
            address: row.address?.trim() || householdAddress,
            gender: this.parseGender(row.gender),
            birthDateSolar,
            birthDateLunar,
            zodiac,
            tags: this.parseTags(row.tags),
          });
          await memberRepo.save(member);
          await this.recomputeHouseholdHead(householdId, manager);
        }

        return rows.length;
      });

      return { successCount, failedRows: [] };
    } catch (err) {
      // 交易已整批回滾，未寫入任何資料（僅未預期的資料庫層級錯誤才會走到這裡）
      return {
        successCount: 0,
        failedRows: [
          {
            rowNumber: 0,
            name: "",
            message: `匯入失敗，未寫入任何資料：${err instanceof Error ? err.message : "未知錯誤"}`,
          },
        ],
      };
    }
  }

  /**
   * 解析匯入檔案的生日欄位：允許西元（4 碼年）或民國（1-3 碼年）格式，年月日之間可用 "-" 或 "/" 分隔，
   * 後面若還有其他文字（例如舊資料表常見的「吉」「亥」等農民曆註記）一律忽略，只取開頭的年月日。
   * 空白或完全無法辨識格式、換算後是不存在的日期（例如非閏年 2/29）都回傳 null，直接跳過該欄位。
   */
  private parseImportBirthDate(raw?: string): string | null {
    const trimmed = raw?.trim() ?? "";
    if (!trimmed) return null;

    const match = /^(\d{1,4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed);
    if (!match) return null;

    const [, yearStr, monthStr, dayStr] = match;
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const gregorianYear = yearStr.length >= 4 ? Number(yearStr) : Number(yearStr) + 1911;
    if (!this.isRealCalendarDate(gregorianYear, month, day)) return null;

    return `${gregorianYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  /**
   * 嚴格檢查年/月/日是否為真實存在的日期（例如非閏年的 2 月沒有 29 日、4 月沒有 31 日）。
   * 不能只用 `new Date(...)` 判斷：JS 的 Date 對超出範圍的日期會自動進位到下個月，
   * 不會回傳無效值，例如 new Date(2018, 1, 29) 會被靜默視為 3 月 1 日，無法藉此抓出不存在的日期。
   */
  private isRealCalendarDate(year: number, month: number, day: number): boolean {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  private parseGender(raw?: string): Gender {
    const v = (raw ?? "").trim().toUpperCase();
    if (v === "男" || v === "MALE" || v === "M") return Gender.MALE;
    if (v === "女" || v === "FEMALE" || v === "F") return Gender.FEMALE;
    return Gender.UNKNOWN;
  }

  private parseTags(raw?: string): MemberTagType[] {
    if (!raw) return [];
    return raw
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => TAG_LABEL_TO_ENUM[s] ?? (Object.values(MemberTagType).includes(s as MemberTagType) ? (s as MemberTagType) : null))
      .filter((t): t is MemberTagType => t !== null);
  }

  async findMemberById(id: string): Promise<MemberDto> {
    const member = await this.memberRepo.findOne({ where: { id } });
    if (!member) {
      throw new NotFoundException("找不到信徒資料");
    }
    return this.toMemberDto(member);
  }

  /**
   * 供歷史紀錄回溯查詢使用（例如收據上的信眾姓名）：信徒可能已被刪除，
   * 這種情況不應該讓收據列印/匯出整個失敗，所以回傳 null 而不是拋錯
   */
  async findMemberByIdOrNull(id: string): Promise<MemberDto | null> {
    const member = await this.memberRepo.findOne({ where: { id } });
    return member ? this.toMemberDto(member) : null;
  }

  /**
   * 刪除信徒資料本身（此方法只處理戶籍模組內部的資料一致性，例如戶長重新指派；
   * 是否有捐款/點燈/活動等歷史紀錄需要先確認的邏輯由呼叫端的 MemberAdminService 負責，
   * 避免 HouseholdModule 反向依賴 Lantern/Ceremony 模組造成循環依賴）
   */
  async deleteMemberRow(id: string): Promise<void> {
    const member = await this.memberRepo.findOne({ where: { id } });
    if (!member) {
      throw new NotFoundException("找不到信徒資料");
    }

    const householdId = member.householdId;
    await this.memberRepo.remove(member);
    await this.recomputeHouseholdHead(householdId);
  }

  /** 供其他模組（如活動報名）取得信徒的地址：優先採用信徒本人填寫的地址，沒有才回退用戶籍地址 */
  async findHouseholdAddressByMemberId(memberId: string): Promise<string | null> {
    const member = await this.memberRepo.findOne({ where: { id: memberId } });
    if (!member) return null;
    if (member.address) return member.address;
    const household = await this.householdRepo.findOne({ where: { id: member.householdId } });
    return household?.address ?? null;
  }

  async findMembersByIds(ids: string[]): Promise<Map<string, MemberDto>> {
    if (ids.length === 0) return new Map();
    const members = await this.memberRepo.find({ where: { id: In(ids) } });
    return new Map(members.map((m) => [m.id, this.toMemberDto(m)]));
  }

  async searchMembers(keyword: string, page = 1, pageSize = 20) {
    const [members, total] = await this.memberRepo.findAndCount({
      where: keyword
        ? [{ name: Like(`%${keyword}%`) }, { phone: Like(`%${keyword}%`) }]
        : {},
      order: { createdAt: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: members.map((m) => this.toMemberDto(m)),
      total,
      page,
      pageSize,
    };
  }

  /** 整戶報名等流程使用：透過地址或戶內任一成員姓名找到該戶 */
  async searchHouseholds(keyword: string, page = 1, pageSize = 20) {
    if (!keyword.trim()) return { items: [] as HouseholdDto[], total: 0, page, pageSize };

    const byAddress = await this.householdRepo.find({ where: { address: Like(`%${keyword}%`) } });
    const matchingMembers = await this.memberRepo.find({ where: { name: Like(`%${keyword}%`) } });
    const memberHouseholdIds = [...new Set(matchingMembers.map((m) => m.householdId))];
    const byMember = memberHouseholdIds.length
      ? await this.householdRepo.find({ where: { id: In(memberHouseholdIds) } })
      : [];

    const merged = new Map([...byAddress, ...byMember].map((h) => [h.id, h]));
    const all = Array.from(merged.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = all.length;
    const items = all.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((h) => this.toHouseholdDto(h));
    return { items, total, page, pageSize };
  }

  /** 整戶報名使用：取得某戶籍下所有信徒 */
  async findMembersByHouseholdId(householdId: string): Promise<MemberDto[]> {
    const members = await this.memberRepo.find({ where: { householdId }, order: { createdAt: "ASC" } });
    return members.map((m) => this.toMemberDto(m));
  }

  private toHouseholdDto(household: Household): HouseholdDto {
    return {
      id: household.id,
      address: household.address,
      phone: household.phone,
      headMemberId: household.headMemberId,
      createdAt: household.createdAt.toISOString(),
    };
  }

  private toMemberDto(member: Member): MemberDto {
    const currentYear = new Date().getFullYear();
    const clash = member.zodiac
      ? this.lunarService.checkZodiacClash(member.zodiac, currentYear)
      : { isClashYear: false };
    return {
      id: member.id,
      householdId: member.householdId,
      name: member.name,
      phone: member.phone,
      address: member.address,
      gender: member.gender,
      birthDateSolar: member.birthDateSolar,
      birthDateLunar: member.birthDateLunar,
      zodiac: member.zodiac,
      isZodiacClashYear: clash.isClashYear,
      tags: member.tags,
      createdAt: member.createdAt.toISOString(),
    };
  }
}
