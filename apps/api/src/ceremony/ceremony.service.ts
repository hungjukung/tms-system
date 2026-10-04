import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import {
  CeremonyDto,
  CeremonyExpenseDto,
  CeremonyFeeMode,
  CeremonyRegistrationDto,
  CeremonyReportDto,
  CeremonySeatDto,
  LedgerEntryStatus,
  LedgerEntryType,
  MemberHistoryEntryDto,
  ReceiptDto,
  ReceiptSourceType,
} from "@tms/shared";
import { HouseholdService } from "../household/household.service";
import { LanternService } from "../lantern/lantern.service";
import { User } from "../auth/entities/user.entity";
import { LedgerEntry } from "../finance/entities/ledger-entry.entity";
import { Ceremony } from "./entities/ceremony.entity";
import { CeremonyRegistration } from "./entities/ceremony-registration.entity";
import { CreateCeremonyDto } from "./dto/create-ceremony.dto";
import { UpdateCeremonyDto } from "./dto/update-ceremony.dto";
import { RegisterCeremonyDto } from "./dto/register-ceremony.dto";

const PG_UNIQUE_VIOLATION = "23505";

@Injectable()
export class CeremonyService {
  constructor(
    @InjectRepository(Ceremony) private readonly ceremonyRepo: Repository<Ceremony>,
    @InjectRepository(CeremonyRegistration)
    private readonly registrationRepo: Repository<CeremonyRegistration>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LedgerEntry) private readonly ledgerRepo: Repository<LedgerEntry>,
    private readonly householdService: HouseholdService,
    private readonly lanternService: LanternService,
  ) {}

  async createCeremony(dto: CreateCeremonyDto): Promise<CeremonyDto> {
    const ceremony = this.ceremonyRepo.create({
      templeId: dto.templeId,
      name: dto.name,
      date: dto.date,
      feeMode: dto.feeMode,
      fixedAmount: dto.fixedAmount != null ? dto.fixedAmount.toFixed(2) : null,
      description: dto.description ?? null,
      tableCount: dto.tableCount ?? null,
      seatsPerTable: dto.seatsPerTable ?? null,
      registrationDeadline: dto.registrationDeadline ?? null,
    });
    const saved = await this.ceremonyRepo.save(ceremony);
    return this.toCeremonyDto(saved, { registrationCount: 0, totalAmount: 0 });
  }

  /**
   * 編輯已建立的活動細節。每桌人數是座位編號（幾桌幾號）的計算基礎，一旦有信眾報名後就不可再更改，
   * 否則既有座位會對應到錯誤的桌號；桌數則可以增加（活動報名踴躍時常見的加開座位需求），
   * 但不可縮減到低於目前已配發出去的座位範圍。
   */
  async updateCeremony(id: string, dto: UpdateCeremonyDto): Promise<CeremonyDto> {
    const ceremony = await this.ceremonyRepo.findOne({ where: { id } });
    if (!ceremony) throw new NotFoundException("找不到活動");

    if (dto.seatsPerTable !== undefined && dto.seatsPerTable !== ceremony.seatsPerTable) {
      const registrationCount = await this.registrationRepo.count({ where: { ceremonyId: id } });
      if (registrationCount > 0) {
        throw new BadRequestException("此活動已有信眾報名，無法修改每桌人數");
      }
    }

    if (dto.tableCount != null && ceremony.tableCount != null && dto.tableCount < ceremony.tableCount) {
      const maxAssignedSeatIndex = await this.getMaxAssignedSeatIndex(ceremony);
      const seatsPerTable = dto.seatsPerTable ?? ceremony.seatsPerTable ?? 0;
      const newTotalSeats = dto.tableCount * seatsPerTable;
      if (maxAssignedSeatIndex > newTotalSeats) {
        throw new BadRequestException("已配發的座位超出新桌數的範圍，無法縮減桌數");
      }
    }

    if (dto.name !== undefined) ceremony.name = dto.name;
    if (dto.date !== undefined) ceremony.date = dto.date;
    if (dto.feeMode !== undefined) ceremony.feeMode = dto.feeMode;
    if (dto.fixedAmount !== undefined) {
      ceremony.fixedAmount = dto.fixedAmount != null ? dto.fixedAmount.toFixed(2) : null;
    } else if (dto.feeMode === CeremonyFeeMode.FREE_WILL) {
      ceremony.fixedAmount = null;
    }
    if (dto.description !== undefined) ceremony.description = dto.description;
    if (dto.tableCount !== undefined) ceremony.tableCount = dto.tableCount;
    if (dto.seatsPerTable !== undefined) ceremony.seatsPerTable = dto.seatsPerTable;
    if (dto.registrationDeadline !== undefined) ceremony.registrationDeadline = dto.registrationDeadline;

    const saved = await this.ceremonyRepo.save(ceremony);
    const stats = await this.getStatsForCeremony(id);
    return this.toCeremonyDto(saved, stats);
  }

  /** 目前已配發出去的座位範圍（取「自動配位計數器」與「手動選位最大座位編號」兩者較大值） */
  private async getMaxAssignedSeatIndex(ceremony: Ceremony): Promise<number> {
    const row = await this.registrationRepo
      .createQueryBuilder("r")
      .select("MAX(r.seatIndex)", "max")
      .where('r."ceremonyId" = :ceremonyId', { ceremonyId: ceremony.id })
      .getRawOne<{ max: string | null }>();
    return Math.max(ceremony.nextSeatIndex, Number(row?.max ?? 0));
  }

  private async getStatsForCeremony(
    ceremonyId: string,
  ): Promise<{ registrationCount: number; totalAmount: number; seatsAssigned: number }> {
    const row = await this.registrationRepo
      .createQueryBuilder("r")
      .select("COUNT(*)", "count")
      .addSelect("SUM(r.amount)", "total")
      // COUNT 會自動忽略 NULL，故未佔座位的報名（noSeatNeeded）不會被計入
      .addSelect('COUNT(r."seatIndex")', "seatsAssigned")
      .where('r."ceremonyId" = :ceremonyId', { ceremonyId })
      .getRawOne<{ count: string; total: string | null; seatsAssigned: string }>();
    return {
      registrationCount: Number(row?.count ?? 0),
      totalAmount: Number(row?.total ?? 0),
      seatsAssigned: Number(row?.seatsAssigned ?? 0),
    };
  }

  /**
   * @param activeOnly 提供時只回傳尚未過期的活動（供「活動報名」頁選單使用）：
   * 有設定報名期限的以期限判斷，未設定（不限）的則以活動日期本身是否已過來判斷，與「建立活動」頁列表的過期判斷一致；
   * 不提供則回傳全部活動，包含已過期的（供「建立活動」頁歷史紀錄與財務查詢使用）
   */
  async listCeremonies(templeId?: string, activeOnly?: boolean): Promise<CeremonyDto[]> {
    const today = this.formatLocalDate(new Date());
    const query = this.ceremonyRepo
      .createQueryBuilder("ceremony")
      .orderBy("ceremony.date", "DESC");
    if (templeId) {
      query.andWhere("ceremony.templeId = :templeId", { templeId });
    }
    if (activeOnly) {
      query.andWhere(
        `((ceremony."registrationDeadline" IS NOT NULL AND ceremony."registrationDeadline" >= :today)
          OR (ceremony."registrationDeadline" IS NULL AND ceremony."date" >= :today))`,
        { today },
      );
    }
    const ceremonies = await query.getMany();
    return this.toCeremonyDtos(ceremonies);
  }

  /** 用「電腦本機時間」的年/月/日組字串，避免受時區換算影響而跑掉一天 */
  private formatLocalDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  async deleteCeremony(id: string, force = false): Promise<void> {
    const ceremony = await this.ceremonyRepo.findOne({ where: { id } });
    if (!ceremony) throw new NotFoundException("找不到活動");

    const registrationCount = await this.registrationRepo.count({ where: { ceremonyId: id } });
    if (registrationCount > 0 && !force) {
      throw new ConflictException({
        message: `此活動已有 ${registrationCount} 筆信眾報名並產生收據，確定要一併刪除嗎？`,
        registrationCount,
      });
    }

    // 強制刪除：報名紀錄會一併移除（資料庫層級 cascade），但已核發的收據金額仍會保留在財務紀錄中，
    // 只是其「項目說明」欄位之後會顯示為空（因來源活動已不存在）
    await this.ceremonyRepo.remove(ceremony);
  }

  /** 建立活動報名紀錄與座位配發（不核發收據），供單一報名流程與「活動報名」合併收據流程共用 */
  private async createRegistrationRecord(
    dto: RegisterCeremonyDto,
    userId: string,
  ): Promise<{ registration: CeremonyRegistration; ceremony: Ceremony }> {
    const ceremony = await this.ceremonyRepo.findOne({ where: { id: dto.ceremonyId } });
    if (!ceremony) throw new NotFoundException("找不到活動");
    if (dto.memberId) {
      await this.householdService.findMemberById(dto.memberId);
    }

    const totalSeats =
      ceremony.tableCount && ceremony.seatsPerTable ? ceremony.tableCount * ceremony.seatsPerTable : null;

    const buildRegistration = () =>
      this.registrationRepo.create({
        ceremonyId: dto.ceremonyId,
        memberId: dto.memberId ?? null,
        walkInName: dto.walkInName ?? null,
        walkInAddress: dto.walkInAddress ?? null,
        amount: dto.amount.toFixed(2),
        wishText: dto.wishText ?? null,
        createdByUserId: userId,
      });

    let saved: CeremonyRegistration;

    if (dto.seatIndex != null) {
      // 手動選位：直接以指定座位建立，靠資料庫唯一約束擋下同座位被搶先選走的情況
      if (!totalSeats || dto.seatIndex < 1 || dto.seatIndex > totalSeats) {
        throw new BadRequestException("座位超出範圍");
      }
      if (!ceremony.seatsPerTable) throw new BadRequestException("此活動未設定座位");
      const registration = buildRegistration();
      registration.seatIndex = dto.seatIndex;
      registration.seatNumber = this.formatSeatNumber(dto.seatIndex, ceremony.seatsPerTable);
      try {
        saved = await this.registrationRepo.save(registration);
      } catch (err) {
        if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
          throw new ConflictException("此座位已被選走，請重新選擇");
        }
        throw err;
      }
    } else {
      saved = await this.registrationRepo.save(buildRegistration());
      if (totalSeats && ceremony.seatsPerTable && !dto.noSeatNeeded) {
        // nextSeatIndex 計數器只會被「自動配位」推進，手動選位（單一選位、整戶多選、認領整桌）
        // 不會同步更新它，計數器配到的座位號碼有可能其實已經被手動選走；遇到唯一約束衝突時
        // 就再往下一個號碼重試，直到找到真正空的座位或座位配發完畢為止
        for (let attempt = 0; attempt < totalSeats; attempt++) {
          const seatIndex = await this.reserveNextSeat(ceremony.id, totalSeats);
          if (seatIndex == null) break; // 座位已全數配發完畢
          saved.seatIndex = seatIndex;
          saved.seatNumber = this.formatSeatNumber(seatIndex, ceremony.seatsPerTable);
          try {
            saved = await this.registrationRepo.save(saved);
            break;
          } catch (err) {
            if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
              continue;
            }
            throw err;
          }
        }
      }
    }

    return { registration: saved, ceremony };
  }

  /** 供選位彈出視窗使用：算出指定活動每個座位目前的狀態（哪桌哪位、是否已被選走、參加者姓名） */
  async getSeatMap(ceremonyId: string): Promise<CeremonySeatDto[]> {
    const ceremony = await this.ceremonyRepo.findOne({ where: { id: ceremonyId } });
    if (!ceremony) throw new NotFoundException("找不到活動");
    if (!ceremony.tableCount || !ceremony.seatsPerTable) return [];

    const allRegistrations = await this.registrationRepo.find({ where: { ceremonyId } });
    // 排除收據已作廢的報名紀錄，不讓已取消的報名繼續佔用座位（跟「報名名單」的排除邏輯一致）
    const voidedIds = await this.lanternService.getVoidedSourceIds(
      ReceiptSourceType.CEREMONY_REGISTRATION,
      allRegistrations.map((r) => r.id),
    );
    const registrations = allRegistrations.filter((r) => !voidedIds.has(r.id));
    const registrationBySeat = new Map(
      registrations.filter((r) => r.seatIndex != null).map((r) => [r.seatIndex as number, r]),
    );

    const memberIds = registrations.map((r) => r.memberId).filter((id): id is string => !!id);
    const memberById = await this.householdService.findMembersByIds([...new Set(memberIds)]);

    const totalSeats = ceremony.tableCount * ceremony.seatsPerTable;
    const seats: CeremonySeatDto[] = [];
    for (let seatIndex = 1; seatIndex <= totalSeats; seatIndex++) {
      const tableNumber = Math.floor((seatIndex - 1) / ceremony.seatsPerTable) + 1;
      const seatInTable = ((seatIndex - 1) % ceremony.seatsPerTable) + 1;
      const registration = registrationBySeat.get(seatIndex);
      const participantName = registration
        ? registration.memberId
          ? memberById.get(registration.memberId)?.name ?? ""
          : registration.walkInName ?? ""
        : undefined;
      seats.push({
        seatIndex,
        tableNumber,
        seatInTable,
        status: registration ? "TAKEN" : "EMPTY",
        participantName,
      });
    }
    return seats;
  }

  async register(
    dto: RegisterCeremonyDto,
    userId: string,
  ): Promise<{ registration: CeremonyRegistrationDto; receipt: ReceiptDto }> {
    const { registration: saved, ceremony } = await this.createRegistrationRecord(dto, userId);

    const issuer = await this.userRepo.findOne({ where: { id: userId } });
    const receipt = await this.lanternService.issueReceipt(
      ReceiptSourceType.CEREMONY_REGISTRATION,
      saved.id,
      dto.amount,
      userId,
      issuer?.displayName ?? "",
      ceremony.templeId,
    );

    const registrationDto = await this.toRegistrationDto(saved, ceremony);
    return { registration: registrationDto, receipt };
  }

  /** 取消單筆尚未開立收據的報名紀錄，供「活動報名」頁在送出並開立收據前，從加入清單中移除項目使用 */
  async cancelRegistration(registrationId: string): Promise<void> {
    const registration = await this.registrationRepo.findOne({ where: { id: registrationId } });
    if (!registration) throw new NotFoundException("找不到報名紀錄");
    await this.registrationRepo.remove(registration);
  }

  /** 供「活動報名」頁合併收據流程使用：建立活動報名紀錄，但不核發收據 */
  async createRegistrationForCombined(
    dto: RegisterCeremonyDto,
    userId: string,
  ): Promise<{
    registration?: CeremonyRegistrationDto;
    registrations?: CeremonyRegistrationDto[];
    payerName: string;
    description: string;
    note?: string;
    templeId: string;
  }> {
    if (dto.householdId) {
      return this.createHouseholdRegistrationForCombined(dto, userId);
    }
    if (dto.tableNumber != null) {
      return this.createTableRegistrationForCombined(dto, userId);
    }
    const { registration: saved, ceremony } = await this.createRegistrationRecord(dto, userId);
    const registrationDto = await this.toRegistrationDto(saved, ceremony);
    const { payerName, description, note } = await this.describeRegistration(saved.id);
    return { registration: registrationDto, payerName, description, note, templeId: ceremony.templeId };
  }

  /**
   * 整戶報名：找出該戶籍下所有信徒，各自建立一筆報名紀錄（金額平均分攤），
   * 但合併成一個項目「活動名稱*n人」印在收據上，付款人姓名列出全戶每個人。
   * 可選：手動選位時 householdSeatIndexes 數量須與戶內人數相同，依序對應每一位信徒；
   * 座位指定與報名一起包在同一個交易內，任何一個座位被搶先選走就整批回滾，不會產生半套資料。
   */
  private async createHouseholdRegistrationForCombined(
    dto: RegisterCeremonyDto,
    userId: string,
  ): Promise<{
    registrations: CeremonyRegistrationDto[];
    payerName: string;
    description: string;
    note?: string;
    templeId: string;
  }> {
    const ceremony = await this.ceremonyRepo.findOne({ where: { id: dto.ceremonyId } });
    if (!ceremony) throw new NotFoundException("找不到活動");

    const members = await this.householdService.findMembersByHouseholdId(dto.householdId as string);
    if (members.length === 0) {
      throw new BadRequestException("此戶籍沒有信徒資料，無法整戶報名");
    }

    const headcount = members.length;
    const perPersonAmount = dto.amount / headcount;

    const seatIndexes = dto.householdSeatIndexes;
    if (seatIndexes) {
      if (seatIndexes.length !== headcount) {
        throw new BadRequestException("選位數量與戶籍人數不符，請重新選位");
      }
      const totalSeats =
        ceremony.tableCount && ceremony.seatsPerTable ? ceremony.tableCount * ceremony.seatsPerTable : null;
      if (!totalSeats || !ceremony.seatsPerTable) {
        throw new BadRequestException("此活動未設定座位");
      }
      for (const seatIndex of seatIndexes) {
        if (seatIndex < 1 || seatIndex > totalSeats) {
          throw new BadRequestException("座位超出範圍");
        }
      }
    }

    let saved: CeremonyRegistration[];
    try {
      saved = await this.registrationRepo.manager.transaction(async (manager) => {
        const rows: CeremonyRegistration[] = [];
        for (let i = 0; i < members.length; i++) {
          const registration = manager.create(CeremonyRegistration, {
            ceremonyId: dto.ceremonyId,
            memberId: members[i].id,
            walkInName: null,
            walkInAddress: null,
            amount: perPersonAmount.toFixed(2),
            wishText: dto.wishText ?? null,
            createdByUserId: userId,
          });
          if (seatIndexes) {
            registration.seatIndex = seatIndexes[i];
            registration.seatNumber = this.formatSeatNumber(seatIndexes[i], ceremony.seatsPerTable as number);
          }
          rows.push(await manager.save(registration));
        }
        return rows;
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("其中有座位已被選走，請重新選擇");
      }
      throw err;
    }

    const registrations = await Promise.all(saved.map((r) => this.toRegistrationDto(r, ceremony)));
    const payerName = members.map((m) => m.name).join("、");
    const description = `${ceremony.name}*${headcount}人`;
    const note = seatIndexes
      ? `座位｜${seatIndexes.map((seatIndex) => this.formatSeatOnly(seatIndex, ceremony.seatsPerTable as number)).join("、")}`
      : undefined;

    return { registrations, payerName, description, note, templeId: ceremony.templeId };
  }

  /**
   * 認領整桌：不用逐一選位，直接把整桌所有座位保留給同一位報名者。
   * 實作上仍會替該桌每個座位各建立一筆報名紀錄（沿用既有的座位唯一約束防止跟其他人衝突選位），
   * 但只有第一個座位掛上真正的報名者與金額，其餘座位只是佔位用（姓名僅供選位畫面顯示、金額為 0，
   * 不會重複計入財務報表或該信徒的參與歷史）。收據項目不列座位號碼，只印「第X桌」。
   */
  private async createTableRegistrationForCombined(
    dto: RegisterCeremonyDto,
    userId: string,
  ): Promise<{
    registration: CeremonyRegistrationDto;
    payerName: string;
    description: string;
    note: string;
    templeId: string;
  }> {
    const ceremony = await this.ceremonyRepo.findOne({ where: { id: dto.ceremonyId } });
    if (!ceremony) throw new NotFoundException("找不到活動");
    if (!ceremony.tableCount || !ceremony.seatsPerTable) {
      throw new BadRequestException("此活動未設定座位");
    }
    const tableNumber = dto.tableNumber as number;
    if (tableNumber < 1 || tableNumber > ceremony.tableCount) {
      throw new BadRequestException("桌號超出範圍");
    }
    if (dto.memberId) {
      await this.householdService.findMemberById(dto.memberId);
    }
    const payerName = dto.memberId
      ? ((await this.householdService.findMemberByIdOrNull(dto.memberId))?.name ?? "")
      : (dto.walkInName ?? "");

    const seatsPerTable = ceremony.seatsPerTable;
    const firstSeatIndex = (tableNumber - 1) * seatsPerTable + 1;
    const seatIndexes = Array.from({ length: seatsPerTable }, (_, i) => firstSeatIndex + i);

    let mainRow: CeremonyRegistration;
    try {
      mainRow = await this.registrationRepo.manager.transaction(async (manager) => {
        let main: CeremonyRegistration | null = null;
        for (const seatIndex of seatIndexes) {
          const isMain = seatIndex === firstSeatIndex;
          const registration = manager.create(CeremonyRegistration, {
            ceremonyId: dto.ceremonyId,
            memberId: isMain ? (dto.memberId ?? null) : null,
            walkInName: isMain ? (dto.walkInName ?? null) : payerName || null,
            walkInAddress: isMain ? (dto.walkInAddress ?? null) : null,
            amount: isMain ? dto.amount.toFixed(2) : "0.00",
            wishText: isMain ? (dto.wishText ?? null) : null,
            seatIndex,
            seatNumber: this.formatSeatNumber(seatIndex, seatsPerTable),
            createdByUserId: userId,
          });
          const row = await manager.save(registration);
          if (isMain) main = row;
        }
        return main as CeremonyRegistration;
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("此桌已有座位被選走，請重新選擇");
      }
      throw err;
    }

    const registration = await this.toRegistrationDto(mainRow, ceremony);
    return {
      registration,
      payerName,
      description: ceremony.name,
      note: `第${tableNumber}桌`,
      templeId: ceremony.templeId,
    };
  }

  /**
   * 原子性地保留下一個座位流水號（1 起算），以條件式 UPDATE 確保多櫃台同時報名時不會分配到同一個座位。
   * 座位已滿時回傳 null（不擋下報名，僅座位號碼留空，需人工另行安排）。
   */
  private async reserveNextSeat(ceremonyId: string, capacity: number): Promise<number | null> {
    const result = await this.ceremonyRepo
      .createQueryBuilder()
      .update(Ceremony)
      .set({ nextSeatIndex: () => '"nextSeatIndex" + 1' })
      .where('id = :id AND "nextSeatIndex" < :capacity', { id: ceremonyId, capacity })
      .returning(["nextSeatIndex"])
      .execute();
    if (result.affected === 0 || !result.raw?.[0]) return null;
    return result.raw[0].nextSeatIndex as number;
  }

  private formatSeatNumber(seatIndex: number, seatsPerTable: number): string {
    const table = Math.floor((seatIndex - 1) / seatsPerTable) + 1;
    const seat = ((seatIndex - 1) % seatsPerTable) + 1;
    return `${table}-${seat}`;
  }

  /** 座位號碼內部存成 "桌-位"（例如 "1-8"），收據上要印成更好讀的「座位：1桌8號」 */
  private formatSeatLabel(seatNumber: string): string {
    const [table, seat] = seatNumber.split("-");
    return `座位：${table}桌${seat}號`;
  }

  /** 同 formatSeatLabel，但不帶「座位：」前綴，供整戶報名逐人列出座位時使用（前綴只需出現一次） */
  private formatSeatOnly(seatIndex: number, seatsPerTable: number): string {
    const table = Math.floor((seatIndex - 1) / seatsPerTable) + 1;
    const seat = ((seatIndex - 1) % seatsPerTable) + 1;
    return `${table}桌${seat}號`;
  }

  /** 供 PrintModule 組合收據內容使用：品項只印活動名稱，座位號碼另外以 note 附註 */
  async describeRegistration(
    registrationId: string,
  ): Promise<{ payerName: string; description: string; note?: string }> {
    const registration = await this.registrationRepo.findOne({ where: { id: registrationId } });
    if (!registration) return { payerName: "", description: "" };
    const ceremony = await this.ceremonyRepo.findOne({ where: { id: registration.ceremonyId } });
    const payerName = await this.resolveParticipantName(registration);
    return {
      payerName,
      description: ceremony?.name ?? "",
      note: registration.seatNumber ? this.formatSeatLabel(registration.seatNumber) : undefined,
    };
  }

  async findHistoryByMemberId(memberId: string): Promise<MemberHistoryEntryDto[]> {
    const registrations = await this.registrationRepo.find({
      where: { memberId },
      order: { createdAt: "DESC" },
    });
    if (registrations.length === 0) return [];
    const ceremonyIds = [...new Set(registrations.map((r) => r.ceremonyId))];
    const ceremonies = await this.ceremonyRepo.findByIds(ceremonyIds);
    const ceremonyMap = new Map(ceremonies.map((c) => [c.id, c.name]));
    return registrations.map((r) => ({
      type: "DONATION" as const,
      id: r.id,
      description: `活動報名（${ceremonyMap.get(r.ceremonyId) ?? ""}）`,
      amount: Number(r.amount),
      occurredAt: r.createdAt.toISOString(),
    }));
  }

  /** 供財務管理「活動查詢」使用：單一活動的整體報名狀況（總金額、報名筆數、逐筆報名明細） */
  async getCeremonyReport(ceremonyId: string): Promise<CeremonyReportDto> {
    const ceremony = await this.ceremonyRepo.findOne({ where: { id: ceremonyId } });
    if (!ceremony) throw new NotFoundException("找不到活動");

    const allRegistrations = await this.registrationRepo.find({
      where: { ceremonyId },
      order: { createdAt: "ASC" },
    });
    // 排除收據已作廢的報名紀錄，不讓已作廢的報名留在活動查詢報表裡
    const voidedIds = await this.lanternService.getVoidedSourceIds(
      ReceiptSourceType.CEREMONY_REGISTRATION,
      allRegistrations.map((r) => r.id),
    );
    const registrations = allRegistrations.filter((r) => !voidedIds.has(r.id));
    // 附上每筆報名對應的收據 id，供「報名名單」查看/刪除收據使用（含未留姓名的報名，一視同仁）
    const receiptIdByRegistration = await this.lanternService.getReceiptIdsBySource(
      ReceiptSourceType.CEREMONY_REGISTRATION,
      registrations.map((r) => r.id),
    );
    const registrationDtos = await Promise.all(
      registrations.map((r) => this.toRegistrationDto(r, ceremony, receiptIdByRegistration.get(r.id) ?? null)),
    );
    const totalAmount = registrations.reduce((sum, r) => sum + Number(r.amount), 0);

    // 活動本身的捐款：獨立於報名費統計，不計入一般捐款分類
    const { total: donationTotal, items: donations } = await this.lanternService.getCeremonyDonationSummary(ceremonyId);

    // 列入活動計算的手動流水帳支出：額外統計進此活動，本身仍照常計入財務報表總支出（不排除），只算已核准的項目
    const expenseEntries = await this.ledgerRepo.find({
      where: { ceremonyId, type: LedgerEntryType.EXPENSE, status: LedgerEntryStatus.APPROVED },
      order: { occurredAt: "ASC" },
    });
    const expenses: CeremonyExpenseDto[] = expenseEntries.map((e) => ({
      category: e.category,
      amount: Number(e.amount),
      description: e.description,
      occurredAt: e.occurredAt,
    }));
    const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

    const seatsAssigned = registrations.filter((r) => r.seatIndex != null).length;

    return {
      ceremony: this.toCeremonyDto(ceremony, { registrationCount: registrations.length, totalAmount, seatsAssigned }),
      totalAmount,
      registrationCount: registrations.length,
      registrations: registrationDtos,
      donationTotal,
      donations,
      expenseTotal,
      expenses,
    };
  }

  private async resolveParticipantName(registration: CeremonyRegistration): Promise<string> {
    if (registration.memberId) {
      const member = await this.householdService.findMemberByIdOrNull(registration.memberId);
      return member?.name ?? "";
    }
    return registration.walkInName ?? "";
  }

  private async resolveParticipantAddress(registration: CeremonyRegistration): Promise<string | null> {
    if (registration.memberId) {
      return this.householdService.findHouseholdAddressByMemberId(registration.memberId);
    }
    return registration.walkInAddress ?? null;
  }

  private toCeremonyDto(
    ceremony: Ceremony,
    stats?: { registrationCount: number; totalAmount: number; seatsAssigned?: number },
  ): CeremonyDto {
    return {
      id: ceremony.id,
      templeId: ceremony.templeId,
      name: ceremony.name,
      date: ceremony.date,
      feeMode: ceremony.feeMode,
      fixedAmount: ceremony.fixedAmount != null ? Number(ceremony.fixedAmount) : null,
      description: ceremony.description,
      tableCount: ceremony.tableCount,
      seatsPerTable: ceremony.seatsPerTable,
      totalSeats:
        ceremony.tableCount && ceremony.seatsPerTable ? ceremony.tableCount * ceremony.seatsPerTable : null,
      seatsAssigned: stats?.seatsAssigned ?? 0,
      registrationDeadline: ceremony.registrationDeadline,
      registrationCount: stats?.registrationCount ?? 0,
      totalAmount: stats?.totalAmount ?? 0,
    };
  }

  /** 供「建立活動」頁歷史列表使用：批次算出每個活動至今的報名筆數與收款總額 */
  private async toCeremonyDtos(ceremonies: Ceremony[]): Promise<CeremonyDto[]> {
    if (ceremonies.length === 0) return [];
    const ceremonyIds = ceremonies.map((c) => c.id);
    const rows = await this.registrationRepo
      .createQueryBuilder("r")
      .select('r."ceremonyId"', "ceremonyId")
      .addSelect("COUNT(*)", "count")
      .addSelect("SUM(r.amount)", "total")
      // COUNT 會自動忽略 NULL，故未佔座位的報名（noSeatNeeded）不會被計入
      .addSelect('COUNT(r."seatIndex")', "seatsAssigned")
      .where('r."ceremonyId" IN (:...ceremonyIds)', { ceremonyIds })
      .groupBy('r."ceremonyId"')
      .getRawMany<{ ceremonyId: string; count: string; total: string; seatsAssigned: string }>();
    const statsMap = new Map(
      rows.map((r) => [
        r.ceremonyId,
        { registrationCount: Number(r.count), totalAmount: Number(r.total), seatsAssigned: Number(r.seatsAssigned) },
      ]),
    );
    return ceremonies.map((c) => this.toCeremonyDto(c, statsMap.get(c.id)));
  }

  private async toRegistrationDto(
    registration: CeremonyRegistration,
    ceremony: Ceremony,
    receiptId: string | null = null,
  ): Promise<CeremonyRegistrationDto> {
    const participantName = await this.resolveParticipantName(registration);
    const participantAddress = await this.resolveParticipantAddress(registration);
    return {
      id: registration.id,
      ceremonyId: registration.ceremonyId,
      ceremonyName: ceremony.name,
      memberId: registration.memberId,
      walkInName: registration.walkInName,
      walkInAddress: registration.walkInAddress,
      participantName,
      participantAddress,
      amount: Number(registration.amount),
      wishText: registration.wishText,
      seatNumber: registration.seatNumber,
      createdAt: registration.createdAt.toISOString(),
      receiptId,
    };
  }
}
