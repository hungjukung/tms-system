import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { And, In, LessThan, MoreThanOrEqual, QueryFailedError, Repository } from "typeorm";
import {
  CeremonyDonationDto,
  DonationDto,
  DonationType,
  IncomeDetailDto,
  LanternSlotStatus,
  LanternWallDto,
  LanternSlotDto,
  MemberHistoryEntryDto,
  ReceiptDto,
  ReceiptItemDto,
  ReceiptSourceType,
  ReceiptStatus,
  UserRole,
} from "@tms/shared";
import { formatLocalDate } from "../common/date-utils";
import { HouseholdService } from "../household/household.service";
import { User } from "../auth/entities/user.entity";
import { Ceremony } from "../ceremony/entities/ceremony.entity";
import { CeremonyRegistration } from "../ceremony/entities/ceremony-registration.entity";
import { Gift } from "../gift/entities/gift.entity";
import { LanternWall } from "./entities/lantern-wall.entity";
import { LanternSlot } from "./entities/lantern-slot.entity";
import { LanternClaim } from "./entities/lantern-claim.entity";
import { Donation } from "./entities/donation.entity";
import { Receipt } from "./entities/receipt.entity";
import { ReceiptAuditLog } from "./entities/receipt-audit-log.entity";
import { ClaimSlotDto } from "./dto/claim-slot.dto";
import { UpdateLanternClaimDto } from "./dto/update-claim.dto";
import { ClaimHouseholdSlotsDto } from "./dto/claim-household-slots.dto";
import { CreateDonationDto } from "./dto/create-donation.dto";
import { CreateWallDto, GenerateSlotsDto, UpdateWallDto } from "./dto/create-wall.dto";
import { LanternGateway } from "./lantern.gateway";

const PG_UNIQUE_VIOLATION = "23505";

@Injectable()
export class LanternService {
  constructor(
    @InjectRepository(LanternWall) private readonly wallRepo: Repository<LanternWall>,
    @InjectRepository(LanternSlot) private readonly slotRepo: Repository<LanternSlot>,
    @InjectRepository(LanternClaim) private readonly claimRepo: Repository<LanternClaim>,
    @InjectRepository(Donation) private readonly donationRepo: Repository<Donation>,
    @InjectRepository(Receipt) private readonly receiptRepo: Repository<Receipt>,
    @InjectRepository(ReceiptAuditLog)
    private readonly auditLogRepo: Repository<ReceiptAuditLog>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Ceremony) private readonly ceremonyRepo: Repository<Ceremony>,
    @InjectRepository(CeremonyRegistration)
    private readonly registrationRepo: Repository<CeremonyRegistration>,
    @InjectRepository(Gift) private readonly giftRepo: Repository<Gift>,
    private readonly householdService: HouseholdService,
    private readonly gateway: LanternGateway,
  ) {}

  async createWall(dto: CreateWallDto): Promise<LanternWallDto> {
    const wall = this.wallRepo.create({
      templeId: dto.templeId,
      name: dto.name,
      year: dto.year,
      slotPrice: dto.slotPrice.toFixed(2),
      isTaisuiWall: dto.isTaisuiWall ?? false,
    });
    const saved = await this.wallRepo.save(wall);
    return this.toWallDto(saved);
  }

  /**
   * 供修改燈牆的點燈內容使用（例如把名稱從「大殿光明燈」改成「平安燈」），以及切換是否為太歲燈牆。
   * 單筆點燈收據的項目名稱是補印/查詢當下即時取燈牆名稱，改名後補印舊收據會顯示新名稱；
   * 合併收據（COMBINED）的項目名稱在開立當下就已固定存檔，改名不會影響已開立的合併收據。
   */
  async updateWall(id: string, dto: UpdateWallDto): Promise<LanternWallDto> {
    const wall = await this.wallRepo.findOne({ where: { id } });
    if (!wall) throw new NotFoundException("找不到燈牆");
    wall.name = dto.name;
    if (dto.isTaisuiWall !== undefined) wall.isTaisuiWall = dto.isTaisuiWall;
    const saved = await this.wallRepo.save(wall);
    return this.toWallDto(saved);
  }

  async listWalls(templeId?: string): Promise<LanternWallDto[]> {
    const walls = await this.wallRepo.find({
      where: templeId ? { templeId } : {},
      order: { year: "DESC", name: "ASC" },
    });
    if (walls.length === 0) return [];

    const stats = await this.wallRepo.query(
      `SELECT
         w.id as "wallId",
         COUNT(DISTINCT s.id) as "slotCount",
         COUNT(DISTINCT c.id) as "claimedCount",
         COALESCE(SUM(c.amount), 0) as "totalAmount"
       FROM lantern_walls w
       LEFT JOIN lantern_slots s ON s."wallId" = w.id
       LEFT JOIN lantern_claims c ON c."slotId" = s.id
       WHERE w.id = ANY($1)
       GROUP BY w.id`,
      [walls.map((w) => w.id)],
    );
    const statMap = new Map<string, { slotCount: number; claimedCount: number; totalAmount: number }>(
      stats.map((r: { wallId: string; slotCount: string; claimedCount: string; totalAmount: string }) => [
        r.wallId,
        { slotCount: Number(r.slotCount), claimedCount: Number(r.claimedCount), totalAmount: Number(r.totalAmount) },
      ]),
    );
    return walls.map((w) => this.toWallDto(w, statMap.get(w.id)));
  }

  /**
   * 刪除燈牆（連同底下所有燈位，資料庫層級 cascade）。若已有信眾點燈（會產生收據），
   * 未指定 force 時先擋下並回傳目前已點燈數，供前端二次確認後再以 force=true 重新呼叫；
   * 已核發的收據金額仍會保留在財務紀錄中，只是其「項目說明」欄位之後會顯示為空（因來源點燈紀錄已不存在）。
   */
  async deleteWall(id: string, force = false): Promise<void> {
    const wall = await this.wallRepo.findOne({ where: { id } });
    if (!wall) throw new NotFoundException("找不到燈牆");

    const claimedCount = await this.claimRepo
      .createQueryBuilder("claim")
      .innerJoin(LanternSlot, "slot", "slot.id = claim.slotId")
      .where("slot.wallId = :id", { id })
      .getCount();
    if (claimedCount > 0 && !force) {
      throw new ConflictException({
        message: `此燈牆已有 ${claimedCount} 盞燈被點亮並產生收據，確定要一併刪除嗎？`,
        claimedCount,
      });
    }

    await this.wallRepo.remove(wall);
  }

  async generateSlots(wallId: string, dto: GenerateSlotsDto): Promise<void> {
    const wall = await this.wallRepo.findOne({ where: { id: wallId } });
    if (!wall) throw new NotFoundException("找不到燈牆");

    // 單排時沿用扁平命名（A-01），跨多排時以「排-號」命名（A1-01）方便對應實體燈牆位置；
    // 編號採用使用者在畫布上點選的實際排號/格號（而非壓縮後的序號），以符合實體燈牆位置
    const isSingleRow = new Set(dto.positions.map((p) => p.row)).size === 1;
    const slots: LanternSlot[] = dto.positions.map((p) => {
      const code = isSingleRow
        ? `${dto.prefix}-${String(p.column).padStart(2, "0")}`
        : `${dto.prefix}${p.row}-${String(p.column).padStart(2, "0")}`;
      return this.slotRepo.create({ wallId, code, row: p.row, column: p.column });
    });

    try {
      await this.slotRepo.save(slots);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("燈位代碼重複，請換一個前綴或確認尚未產生過這批燈位");
      }
      throw err;
    }
  }

  async getWallSlots(wallId: string): Promise<LanternSlotDto[]> {
    const wall = await this.wallRepo.findOne({ where: { id: wallId } });
    if (!wall) throw new NotFoundException("找不到燈牆");

    const slots = await this.slotRepo.find({ where: { wallId }, order: { row: "ASC", column: "ASC" } });
    const claims = await this.claimRepo.find({
      where: { slotId: In(slots.map((s) => s.id)), year: wall.year },
    });
    const claimBySlotId = new Map(claims.map((c) => [c.slotId, c]));
    const memberMap = await this.householdService.findMembersByIds(
      claims.map((c) => c.memberId).filter((id): id is string => !!id),
    );

    return slots.map((slot) => this.toSlotDto(slot, claimBySlotId.get(slot.id), memberMap));
  }

  /** 認領燈位並建立紀錄（不核發收據），供單一認領流程與「活動報名」合併收據流程共用 */
  private async claimSlotRecord(
    dto: ClaimSlotDto,
    userId: string,
  ): Promise<{ slotDto: LanternSlotDto; claim: LanternClaim; templeId: string }> {
    const slot = await this.slotRepo.findOne({ where: { id: dto.slotId } });
    if (!slot) throw new NotFoundException("找不到燈位");
    const wall = await this.wallRepo.findOne({ where: { id: slot.wallId } });
    if (!wall) throw new NotFoundException("找不到燈牆");
    if (dto.memberId) {
      await this.householdService.findMemberById(dto.memberId); // 確認信徒存在
    }

    const claim = this.claimRepo.create({
      slotId: dto.slotId,
      year: wall.year,
      memberId: dto.memberId ?? null,
      walkInName: dto.memberId ? null : (dto.walkInName ?? null),
      wishText: dto.wishText ?? null,
      petitionText: dto.petitionText ?? null,
      lanternType: dto.lanternType ?? null,
      amount: dto.amount.toFixed(2),
      createdByUserId: userId,
    });

    let savedClaim: LanternClaim;
    try {
      savedClaim = await this.claimRepo.save(claim);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("此燈位已被其他櫃台認領，請重新整理燈牆後選擇其他燈位");
      }
      throw err;
    }

    const memberMap = dto.memberId ? await this.householdService.findMembersByIds([dto.memberId]) : new Map();
    const slotDto = this.toSlotDto(slot, savedClaim, memberMap);
    this.gateway.broadcastSlotClaimed({ wallId: slot.wallId, slot: slotDto });

    return { slotDto, claim: savedClaim, templeId: wall.templeId };
  }

  /**
   * 編輯已認領燈位的資料（姓名／信徒、祈願內容、疏文、點燈內容），供修正輸入錯誤使用。
   * 金額不開放在此修改：金額已核發收據，如需更正金額請改用「作廢收據」重新開立，避免帳務金額與收據記錄不一致。
   */
  async updateClaim(claimId: string, dto: UpdateLanternClaimDto): Promise<LanternSlotDto> {
    const claim = await this.claimRepo.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException("找不到點燈紀錄");

    if (dto.memberId !== undefined) {
      if (dto.memberId) {
        await this.householdService.findMemberById(dto.memberId);
        claim.memberId = dto.memberId;
        claim.walkInName = null;
      } else {
        claim.memberId = null;
      }
    }
    if (dto.walkInName !== undefined) {
      claim.walkInName = dto.walkInName;
      if (dto.walkInName) claim.memberId = null;
    }
    if (dto.wishText !== undefined) claim.wishText = dto.wishText;
    if (dto.petitionText !== undefined) claim.petitionText = dto.petitionText;
    if (dto.lanternType !== undefined) claim.lanternType = dto.lanternType;

    const saved = await this.claimRepo.save(claim);
    const slot = await this.slotRepo.findOne({ where: { id: saved.slotId } });
    if (!slot) throw new NotFoundException("找不到燈位");
    const memberMap = saved.memberId ? await this.householdService.findMembersByIds([saved.memberId]) : new Map();
    const slotDto = this.toSlotDto(slot, saved, memberMap);
    this.gateway.broadcastSlotClaimed({ wallId: slot.wallId, slot: slotDto });
    return slotDto;
  }

  /**
   * 整戶點燈：一次把整戶（依人數）分別認領同一面燈牆上的多個燈位，金額平均分攤到每筆認領紀錄，
   * 但合併成一個項目「點燈*n人」印在收據上，付款人姓名列出全戶每個人；燈位號碼列在收據備註（只列號碼不列姓名）。
   * 不同燈牆的認領各自獨立呼叫此方法，故同一戶可以在不同燈牆上各自點滿整戶人數的燈位。
   */
  async claimSlotsForHouseholdCombined(
    dto: ClaimHouseholdSlotsDto,
    userId: string,
  ): Promise<{ payerName: string; description: string; note: string; templeId: string; claimIds: string[] }> {
    const wall = await this.wallRepo.findOne({ where: { id: dto.wallId } });
    if (!wall) throw new NotFoundException("找不到燈牆");

    const members = await this.householdService.findMembersByHouseholdId(dto.householdId);
    if (members.length === 0) {
      throw new BadRequestException("此戶籍沒有信徒資料，無法整戶點燈");
    }
    if (dto.slotIds.length !== members.length) {
      throw new BadRequestException("選位數量與戶籍人數不符，請重新選位");
    }

    const slots = await this.slotRepo.find({ where: { id: In(dto.slotIds) } });
    const slotById = new Map(slots.map((s) => [s.id, s]));
    if (slots.length !== dto.slotIds.length || slots.some((s) => s.wallId !== dto.wallId)) {
      throw new BadRequestException("燈位不屬於此燈牆");
    }

    const perPersonAmount = dto.amount / members.length;

    let savedClaims: LanternClaim[];
    try {
      savedClaims = await this.claimRepo.manager.transaction(async (manager) => {
        const rows: LanternClaim[] = [];
        for (let i = 0; i < members.length; i++) {
          const claim = manager.create(LanternClaim, {
            slotId: dto.slotIds[i],
            year: wall.year,
            memberId: members[i].id,
            walkInName: null,
            wishText: null,
            amount: perPersonAmount.toFixed(2),
            createdByUserId: userId,
          });
          rows.push(await manager.save(claim));
        }
        return rows;
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("其中有燈位已被其他櫃台認領，請重新整理後選擇其他燈位");
      }
      throw err;
    }

    const memberMap = await this.householdService.findMembersByIds(members.map((m) => m.id));
    for (const claim of savedClaims) {
      const slot = slotById.get(claim.slotId);
      if (slot) {
        this.gateway.broadcastSlotClaimed({ wallId: dto.wallId, slot: this.toSlotDto(slot, claim, memberMap) });
      }
    }

    const payerName = members.map((m) => m.name).join("、");
    const description = `點燈*${members.length}人`;
    const note = `燈位｜${savedClaims.map((c) => slotById.get(c.slotId)?.code ?? "").join("、")}`;

    return { payerName, description, note, templeId: wall.templeId, claimIds: savedClaims.map((c) => c.id) };
  }

  /** 取消單筆尚未開立收據的點燈認領紀錄，供「活動報名」頁在送出並開立收據前，從加入清單中移除項目使用 */
  async cancelClaim(claimId: string): Promise<void> {
    const claim = await this.claimRepo.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException("找不到點燈紀錄");
    const slot = await this.slotRepo.findOne({ where: { id: claim.slotId } });
    await this.claimRepo.remove(claim);
    if (slot) {
      this.gateway.broadcastSlotClaimed({ wallId: slot.wallId, slot: this.toSlotDto(slot, undefined, new Map()) });
    }
  }

  async claimSlot(dto: ClaimSlotDto, userId: string): Promise<{ slot: LanternSlotDto; receipt: ReceiptDto }> {
    const { slotDto, claim, templeId } = await this.claimSlotRecord(dto, userId);
    const issuer = await this.userRepo.findOne({ where: { id: userId } });
    const receipt = await this.issueReceipt(
      ReceiptSourceType.LANTERN_CLAIM,
      claim.id,
      dto.amount,
      userId,
      issuer?.displayName ?? "",
      templeId,
    );
    return { slot: slotDto, receipt };
  }

  /** 供「活動報名」頁合併收據流程使用：立即建立認領紀錄（點燈牆選位當下就要卡位），但不核發收據 */
  async claimSlotForCombined(
    dto: ClaimSlotDto,
    userId: string,
  ): Promise<{
    slot: LanternSlotDto;
    claimId: string;
    payerName: string;
    description: string;
    note?: string;
    templeId: string;
  }> {
    const { slotDto, claim, templeId } = await this.claimSlotRecord(dto, userId);
    const { payerName, description, note } = await this.describeLanternSource(
      ReceiptSourceType.LANTERN_CLAIM,
      claim.id,
    );
    return { slot: slotDto, claimId: claim.id, payerName, description, note, templeId };
  }

  /**
   * 建立油香捐款紀錄（不核發收據），供單一捐款流程與「活動報名」合併收據流程共用。
   * customItem/quantity（自訂捐款項目與數量）僅總幹事可填寫，其餘角色一律拒絕。
   */
  private async createDonationRecord(dto: CreateDonationDto, userId: string, userRole: UserRole): Promise<Donation> {
    if ((dto.customItem || dto.quantity !== undefined) && userRole !== UserRole.DIRECTOR) {
      throw new ForbiddenException("只有總幹事可以自訂捐款項目與數量");
    }
    if (dto.memberId) {
      await this.householdService.findMemberById(dto.memberId);
    }
    if (dto.ceremonyId) {
      const ceremony = await this.ceremonyRepo.findOne({ where: { id: dto.ceremonyId } });
      if (!ceremony) throw new NotFoundException("找不到活動");
    }
    const donation = this.donationRepo.create({
      templeId: dto.templeId,
      memberId: dto.memberId ?? null,
      walkInName: dto.walkInName ?? null,
      // 指定捐給某個活動時，一律歸為活動捐款分類，不受前端送來的 type 影響，避免跟一般捐款分類混淆
      type: dto.ceremonyId ? DonationType.CEREMONY : dto.type,
      amount: dto.amount.toFixed(2),
      note: dto.note ?? null,
      customItem: dto.customItem ?? null,
      quantity: dto.quantity ?? null,
      ceremonyId: dto.ceremonyId ?? null,
      createdByUserId: userId,
    });
    return this.donationRepo.save(donation);
  }

  async createDonation(
    dto: CreateDonationDto,
    userId: string,
    userRole: UserRole,
  ): Promise<{ donation: DonationDto; receipt: ReceiptDto }> {
    const saved = await this.createDonationRecord(dto, userId, userRole);
    const issuer = await this.userRepo.findOne({ where: { id: userId } });
    const receipt = await this.issueReceipt(
      ReceiptSourceType.DONATION,
      saved.id,
      dto.amount,
      userId,
      issuer?.displayName ?? "",
      dto.templeId,
    );
    return { donation: this.toDonationDto(saved), receipt };
  }

  /** 供「活動報名」頁合併收據流程使用：建立捐款紀錄，但不核發收據 */
  async createDonationForCombined(
    dto: CreateDonationDto,
    userId: string,
    userRole: UserRole,
  ): Promise<{ donation: DonationDto; payerName: string; description: string; note?: string }> {
    const saved = await this.createDonationRecord(dto, userId, userRole);
    const { payerName, description, note } = await this.describeLanternSource(ReceiptSourceType.DONATION, saved.id);
    return { donation: this.toDonationDto(saved), payerName, description, note };
  }

  private static readonly donationTypeLabel: Record<DonationType, string> = {
    [DonationType.YOU_XIANG]: "油香捐款",
    [DonationType.SUI_XI]: "隨喜捐款",
    [DonationType.CEREMONY]: "活動捐款",
    [DonationType.OTHER]: "其他捐款",
    [DonationType.GENERAL]: "一般捐款",
    [DonationType.PUDU]: "普渡捐款",
    [DonationType.PILGRIMAGE]: "進香捐款",
    [DonationType.RENOVATION]: "修繕捐款",
    [DonationType.CONSTRUCTION]: "建設捐款",
  };

  /**
   * 合併收據逐項歸類：活動報名項目的說明文字已改印活動名稱（不再帶「活動報名」字樣），
   * 靠 item.category 標記辨識；點燈固定文字直接比對；油香捐款的說明文字本身
   * 就已經是分類用的中文標籤（油香/隨喜/活動/其他捐款），直接用即可
   */
  private categorizeCombinedItemLabel(item: ReceiptItemDto): string {
    if (item.category === "CEREMONY_REGISTRATION") return "活動報名";
    if (item.description.startsWith("點燈")) return "點燈";
    return item.description;
  }

  /** 供財務報表使用：計算指定期間內油香/點燈/活動收入的分類總計與逐筆明細（含捐款人/參加者姓名，不含已作廢收據）；有指定 templeId 時只算該廟 */
  async getIssuedIncomeReport(
    startInclusive: Date,
    endExclusive: Date,
    templeId?: string,
  ): Promise<{ byCategory: { label: string; amount: number }[]; details: IncomeDetailDto[] }> {
    const receipts = await this.receiptRepo.find({
      where: {
        status: ReceiptStatus.ISSUED,
        createdAt: And(MoreThanOrEqual(startInclusive), LessThan(endExclusive)),
        ...(templeId ? { templeId } : {}),
      },
      order: { createdAt: "ASC" },
    });

    const idsBySource = (type: ReceiptSourceType) =>
      receipts.filter((r) => r.sourceType === type && r.sourceId).map((r) => r.sourceId as string);
    const donationIds = idsBySource(ReceiptSourceType.DONATION);
    const claimIds = idsBySource(ReceiptSourceType.LANTERN_CLAIM);
    const registrationIds = idsBySource(ReceiptSourceType.CEREMONY_REGISTRATION);

    const [donations, claims, registrations] = await Promise.all([
      donationIds.length ? this.donationRepo.find({ where: { id: In(donationIds) } }) : Promise.resolve([]),
      claimIds.length ? this.claimRepo.find({ where: { id: In(claimIds) } }) : Promise.resolve([]),
      registrationIds.length
        ? this.registrationRepo.find({ where: { id: In(registrationIds) } })
        : Promise.resolve([]),
    ]);
    const donationById = new Map(donations.map((d) => [d.id, d]));
    const claimById = new Map(claims.map((c) => [c.id, c]));
    const registrationById = new Map(registrations.map((r) => [r.id, r]));

    // 指定捐給某個活動的捐款，分類標籤改用「{活動名稱} 捐款」，不跟一般捐款分類混在一起統計
    const donationCeremonyIds = [...new Set(donations.map((d) => d.ceremonyId).filter((id): id is string => !!id))];
    const ceremoniesForDonations = donationCeremonyIds.length
      ? await this.ceremonyRepo.find({ where: { id: In(donationCeremonyIds) } })
      : [];
    const ceremonyById = new Map(ceremoniesForDonations.map((c) => [c.id, c]));
    const donationLabel = (donation?: Donation) => {
      if (!donation) return "油香捐款";
      if (donation.ceremonyId) {
        const ceremony = ceremonyById.get(donation.ceremonyId);
        if (ceremony) return `${ceremony.name} 捐款`;
      }
      return LanternService.donationTypeLabel[donation.type];
    };

    // 點燈項目名稱改用燈牆名稱（例如「光明燈」「平安燈」），不再固定顯示「點燈」二字
    const claimSlotIds = [...new Set(claims.map((c) => c.slotId))];
    const slotsForClaims = claimSlotIds.length ? await this.slotRepo.find({ where: { id: In(claimSlotIds) } }) : [];
    const slotById = new Map(slotsForClaims.map((s) => [s.id, s]));
    const wallIdsForClaims = [...new Set(slotsForClaims.map((s) => s.wallId))];
    const wallsForClaims = wallIdsForClaims.length
      ? await this.wallRepo.find({ where: { id: In(wallIdsForClaims) } })
      : [];
    const wallById = new Map(wallsForClaims.map((w) => [w.id, w]));
    const wallNameForClaim = (claim?: LanternClaim) =>
      claim?.lanternType || (claim && wallById.get(slotById.get(claim.slotId)?.wallId ?? "")?.name) || "點燈";

    const memberIds = [
      ...donations.map((d) => d.memberId),
      ...claims.map((c) => c.memberId),
      ...registrations.map((r) => r.memberId),
    ].filter((id): id is string => !!id);
    const memberById = await this.householdService.findMembersByIds([...new Set(memberIds)]);

    const totals = new Map<string, number>();
    const add = (label: string, amount: number) => totals.set(label, (totals.get(label) ?? 0) + amount);
    const details: IncomeDetailDto[] = [];

    for (const r of receipts) {
      const amount = Number(r.amount);
      if (r.sourceType === ReceiptSourceType.COMBINED) {
        for (const item of r.items ?? []) {
          const label = this.categorizeCombinedItemLabel(item);
          add(label, item.amount);
          details.push({
            label,
            amount: item.amount,
            payerName: r.payerName ?? "",
            occurredAt: r.createdAt.toISOString(),
            receiptNo: r.receiptNo,
            note: item.note,
          });
        }
        continue;
      }

      let label = "";
      let payerName = "";
      if (r.sourceType === ReceiptSourceType.LANTERN_CLAIM) {
        const claim = r.sourceId ? claimById.get(r.sourceId) : undefined;
        label = wallNameForClaim(claim);
        payerName = claim?.memberId
          ? (memberById.get(claim.memberId)?.name ?? "")
          : (claim?.walkInName ?? "");
      } else if (r.sourceType === ReceiptSourceType.DONATION) {
        const donation = r.sourceId ? donationById.get(r.sourceId) : undefined;
        label = donationLabel(donation);
        payerName = donation?.memberId
          ? memberById.get(donation.memberId)?.name ?? ""
          : donation?.walkInName ?? "";
      } else if (r.sourceType === ReceiptSourceType.CEREMONY_REGISTRATION) {
        label = "活動報名";
        const registration = r.sourceId ? registrationById.get(r.sourceId) : undefined;
        payerName = registration?.memberId
          ? memberById.get(registration.memberId)?.name ?? ""
          : registration?.walkInName ?? "";
      }

      add(label, amount);
      details.push({
        label,
        amount,
        payerName,
        occurredAt: r.createdAt.toISOString(),
        receiptNo: r.receiptNo,
      });
    }

    const byCategory = Array.from(totals.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);

    return { byCategory, details };
  }

  /**
   * 供「建立活動」頁的活動詳情、以及「財務管理」的活動查詢使用：計算指定活動本身的捐款總額與逐筆明細
   * （不含活動報名費，兩者分開統計）。排除收據已作廢的捐款，不讓已作廢的捐款留在活動查詢報表裡。
   */
  async getCeremonyDonationSummary(ceremonyId: string): Promise<{ total: number; items: CeremonyDonationDto[] }> {
    const donations = await this.donationRepo.find({ where: { ceremonyId }, order: { createdAt: "ASC" } });
    if (donations.length === 0) return { total: 0, items: [] };

    const voidedIds = await this.getVoidedSourceIds(
      ReceiptSourceType.DONATION,
      donations.map((d) => d.id),
    );
    const activeDonations = donations.filter((d) => !voidedIds.has(d.id));
    const memberIds = activeDonations.map((d) => d.memberId).filter((id): id is string => !!id);
    const memberById = await this.householdService.findMembersByIds([...new Set(memberIds)]);

    const items: CeremonyDonationDto[] = activeDonations.map((d) => ({
      payerName: d.memberId ? (memberById.get(d.memberId)?.name ?? "") : (d.walkInName ?? ""),
      amount: Number(d.amount),
      note: d.note,
      createdAt: d.createdAt.toISOString(),
    }));
    const total = items.reduce((sum, i) => sum + i.amount, 0);
    return { total, items };
  }

  /** 供「審核日誌」日曆使用：查詢期間內（依台灣本地時間分天）哪些日期有已開立收據的收入（點燈/捐款/法會報名/送禮） */
  async getIssuedReceiptDates(startInclusive: Date, endExclusive: Date, templeId?: string): Promise<string[]> {
    const receipts = await this.receiptRepo.find({
      where: {
        status: ReceiptStatus.ISSUED,
        createdAt: And(MoreThanOrEqual(startInclusive), LessThan(endExclusive)),
        ...(templeId ? { templeId } : {}),
      },
      select: ["createdAt"],
    });
    return Array.from(new Set(receipts.map((r) => formatLocalDate(r.createdAt))));
  }

  /**
   * 供「最近收據」分頁瀏覽使用；有提供 keyword 時依收據編號或信眾姓名（含臨櫃姓名／已建檔信徒姓名）模糊搜尋，
   * 有提供 activitySourceType 時依活動類型篩選（點燈/捐款/法會報名/送禮，可與關鍵字搜尋同時使用）。
   * 信眾姓名分散存在捐款/點燈/法會報名各自的來源資料表裡（合併收據則直接存在 receipts.payerName），
   * 故用一個原生 SQL 先找出符合條件的收據 id，再照常分頁查詢。
   * 合併收據（COMBINED）沒有單一 sourceType，改用 items[].sourceRefs 判斷是否涵蓋該活動類型；
   * 此欄位僅此功能上線後才建立的合併收據才有記錄，上線前的舊合併收據無法回溯篩選。
   */
  async listReceipts(
    keyword?: string,
    page = 1,
    pageSize = 20,
    activitySourceType?: ReceiptSourceType,
  ): Promise<{ items: ReceiptDto[]; total: number; page: number; pageSize: number }> {
    let matchingIds: string[] | undefined;
    const trimmed = keyword?.trim();
    if (trimmed || activitySourceType) {
      const params: string[] = [];
      const conditions: string[] = [];
      if (trimmed) {
        params.push(`%${trimmed}%`);
        const p = `$${params.length}`;
        conditions.push(
          `(r."receiptNo" ILIKE ${p} OR r."payerName" ILIKE ${p}
             OR d."walkInName" ILIKE ${p} OR dm.name ILIKE ${p}
             OR c."walkInName" ILIKE ${p} OR cm.name ILIKE ${p}
             OR cr."walkInName" ILIKE ${p} OR crm.name ILIKE ${p})`,
        );
      }
      if (activitySourceType) {
        params.push(activitySourceType);
        const p = `$${params.length}`;
        conditions.push(
          `(r."sourceType"::text = ${p}
             OR (r."sourceType"::text = 'COMBINED' AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(COALESCE(r.items, '[]'::jsonb)) item,
                               jsonb_array_elements(COALESCE(item->'sourceRefs', '[]'::jsonb)) ref
                  WHERE ref->>'sourceType' = ${p}
                )))`,
        );
      }
      const rows = await this.receiptRepo.query(
        `SELECT DISTINCT r.id
         FROM receipts r
         LEFT JOIN donations d ON r."sourceType" = 'DONATION' AND r."sourceId" = d.id::text
         LEFT JOIN members dm ON d."memberId" = dm.id
         LEFT JOIN lantern_claims c ON r."sourceType" = 'LANTERN_CLAIM' AND r."sourceId" = c.id::text
         LEFT JOIN members cm ON c."memberId" = cm.id::text
         LEFT JOIN ceremony_registrations cr ON r."sourceType" = 'CEREMONY_REGISTRATION' AND r."sourceId" = cr.id::text
         LEFT JOIN members crm ON cr."memberId" = crm.id
         WHERE ${conditions.join(" AND ")}`,
        params,
      );
      const ids: string[] = rows.map((row: { id: string }) => row.id);
      if (ids.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
      matchingIds = ids;
    }

    const [receipts, total] = await this.receiptRepo.findAndCount({
      where: matchingIds ? { id: In(matchingIds) } : {},
      order: { createdAt: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const userIds = [
      ...new Set(receipts.flatMap((r) => [r.issuedByUserId, r.voidedByUserId].filter(Boolean) as string[])),
    ];
    const users = userIds.length ? await this.userRepo.find({ where: { id: In(userIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, u.displayName]));
    return {
      items: receipts.map((r) => this.toReceiptDto(r, userMap.get(r.issuedByUserId) ?? "")),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 真正從資料庫永久刪除收據紀錄（連同稽核紀錄），不同於「作廢」（保留紀錄但標記無效）。
   * 此操作無法復原，且會影響財務報表的歷史金額加總，僅供清除明顯建錯/重複的收據使用。
   */
  /**
   * 刪除收據時一併清除對應的來源紀錄（點燈認領/捐款/法會報名/送禮），避免報表、活動查詢等地方
   * 殘留已刪除收據的資料。單筆收據可直接用 sourceType/sourceId 回推；合併收據則逐一清除
   * items[].sourceRefs 記錄的每一筆來源（此後才建立的合併收據才有記錄，舊資料無法回溯清除）。
   */
  async deleteReceipt(receiptId: string): Promise<void> {
    const receipt = await this.receiptRepo.findOne({ where: { id: receiptId } });
    if (!receipt) throw new NotFoundException("找不到收據");

    for (const ref of this.getSourceRefs(receipt)) {
      await this.deleteSourceRef(ref);
    }

    await this.auditLogRepo.delete({ receiptId });
    await this.receiptRepo.remove(receipt);
  }

  /** 單筆收據可直接用 sourceType/sourceId 回推；合併收據則展開 items[].sourceRefs 逐一列出涵蓋的每一筆來源 */
  private getSourceRefs(receipt: Receipt): { sourceType: ReceiptSourceType; sourceId: string }[] {
    return receipt.sourceType === ReceiptSourceType.COMBINED
      ? (receipt.items ?? []).flatMap((item) => item.sourceRefs ?? [])
      : receipt.sourceId
        ? [{ sourceType: receipt.sourceType, sourceId: receipt.sourceId }]
        : [];
  }

  private async deleteSourceRef(ref: { sourceType: ReceiptSourceType; sourceId: string }): Promise<void> {
    if (ref.sourceType === ReceiptSourceType.LANTERN_CLAIM) {
      const claim = await this.claimRepo.findOne({ where: { id: ref.sourceId } });
      if (!claim) return;
      const slot = await this.slotRepo.findOne({ where: { id: claim.slotId } });
      await this.claimRepo.remove(claim);
      if (slot) {
        this.gateway.broadcastSlotClaimed({ wallId: slot.wallId, slot: this.toSlotDto(slot, undefined, new Map()) });
      }
    } else if (ref.sourceType === ReceiptSourceType.DONATION) {
      await this.donationRepo.delete({ id: ref.sourceId });
    } else if (ref.sourceType === ReceiptSourceType.CEREMONY_REGISTRATION) {
      await this.registrationRepo.delete({ id: ref.sourceId });
    } else if (ref.sourceType === ReceiptSourceType.GIFT) {
      await this.giftRepo.delete({ id: ref.sourceId });
    }
  }

  /**
   * 供其他報表查詢使用：找出「曾被收據涵蓋過，但涵蓋它的收據全部都已作廢」的來源紀錄 id。
   * 只排除確實被作廢收據涵蓋過的紀錄；從未開過收據的（例如活動報名頁尚未送出的暫存項目）不受影響。
   * 僅涵蓋此功能上線後才建立、有記錄 sourceRefs 的合併收據；上線前的舊合併收據無法回溯判斷。
   * 點燈/法會報名作廢時現在會直接刪除來源紀錄（釋放座位/燈位），此函式主要用於：
   * (1) 沒有座位概念、作廢時不刪除紀錄的捐款/送禮，(2) 此功能上線前就已作廢、來源紀錄尚未被清除的舊資料。
   */
  async getVoidedSourceIds(sourceType: ReceiptSourceType, sourceIds: string[]): Promise<Set<string>> {
    if (!sourceIds.length) return new Set();
    const excluded = new Set<string>();

    const standaloneVoided = await this.receiptRepo.find({
      where: { sourceType, sourceId: In(sourceIds), status: ReceiptStatus.VOIDED },
    });
    standaloneVoided.forEach((r) => r.sourceId && excluded.add(r.sourceId));

    const combinedVoided = await this.receiptRepo.find({
      where: { sourceType: ReceiptSourceType.COMBINED, status: ReceiptStatus.VOIDED },
    });
    for (const r of combinedVoided) {
      for (const item of r.items ?? []) {
        for (const ref of item.sourceRefs ?? []) {
          if (ref.sourceType === sourceType && sourceIds.includes(ref.sourceId)) excluded.add(ref.sourceId);
        }
      }
    }
    return excluded;
  }

  /**
   * 供其他模組查詢使用：找出每筆來源紀錄對應到哪一張收據（單筆收據可直接用 sourceType/sourceId 比對，
   * 合併收據則要比對 items[].sourceRefs），供「報名名單」等管理畫面附上收據連結以便查看/刪除使用。
   * 找不到收據（例如舊資料或已被刪除）的來源不會出現在回傳的 Map 裡。
   */
  async getReceiptIdsBySource(sourceType: ReceiptSourceType, sourceIds: string[]): Promise<Map<string, string>> {
    const receiptIdBySourceId = new Map<string, string>();
    if (!sourceIds.length) return receiptIdBySourceId;

    const standalone = await this.receiptRepo.find({ where: { sourceType, sourceId: In(sourceIds) } });
    for (const r of standalone) {
      if (r.sourceId) receiptIdBySourceId.set(r.sourceId, r.id);
    }

    const combined = await this.receiptRepo.find({ where: { sourceType: ReceiptSourceType.COMBINED } });
    for (const r of combined) {
      for (const item of r.items ?? []) {
        for (const ref of item.sourceRefs ?? []) {
          if (ref.sourceType === sourceType && sourceIds.includes(ref.sourceId) && !receiptIdBySourceId.has(ref.sourceId)) {
            receiptIdBySourceId.set(ref.sourceId, r.id);
          }
        }
      }
    }
    return receiptIdBySourceId;
  }

  async voidReceipt(receiptId: string, reason: string, userId: string): Promise<ReceiptDto> {
    const receipt = await this.receiptRepo.findOne({ where: { id: receiptId } });
    if (!receipt) throw new NotFoundException("找不到收據");
    if (receipt.status === ReceiptStatus.VOIDED) {
      throw new ConflictException("收據已經作廢過了");
    }
    receipt.status = ReceiptStatus.VOIDED;
    receipt.voidedByUserId = userId;
    receipt.voidedReason = reason;
    receipt.voidedAt = new Date();
    const saved = await this.receiptRepo.save(receipt);

    // 作廢時一併釋放對應的座位／燈位，讓其他人可以重新選用；捐款/送禮沒有座位概念，紀錄本身保留（僅在報表中排除）
    const seatRefs = this.getSourceRefs(receipt).filter(
      (ref) =>
        ref.sourceType === ReceiptSourceType.LANTERN_CLAIM ||
        ref.sourceType === ReceiptSourceType.CEREMONY_REGISTRATION,
    );
    for (const ref of seatRefs) {
      await this.deleteSourceRef(ref);
    }

    await this.auditLogRepo.save(
      this.auditLogRepo.create({
        receiptId: receipt.id,
        action: "VOID",
        performedByUserId: userId,
        reason,
      }),
    );

    const issuer = await this.userRepo.findOne({ where: { id: saved.issuedByUserId } });
    return this.toReceiptDto(saved, issuer?.displayName ?? "");
  }

  /** 收據的基本資料（不含來源明細），供 PrintModule 統籌其他模組（如活動報名）組合列印內容 */
  async getReceiptCore(receiptId: string) {
    const receipt = await this.receiptRepo.findOne({ where: { id: receiptId } });
    if (!receipt) throw new NotFoundException("找不到收據");
    const issuer = await this.userRepo.findOne({ where: { id: receipt.issuedByUserId } });
    return {
      receiptNo: receipt.receiptNo,
      amount: Number(receipt.amount),
      status: receipt.status,
      createdAt: receipt.createdAt.toISOString(),
      issuedByName: issuer?.displayName ?? "",
      sourceType: receipt.sourceType,
      sourceId: receipt.sourceId ?? "",
      templeId: receipt.templeId,
      payerName: receipt.payerName ?? undefined,
      items: receipt.items ?? undefined,
    };
  }

  /** 描述油香/點燈類收據的付款人與項目說明（活動報名收據由 CeremonyModule 自行描述） */
  async describeLanternSource(
    sourceType: ReceiptSourceType,
    sourceId: string,
  ): Promise<{ payerName: string; description: string; note?: string }> {
    if (sourceType === ReceiptSourceType.DONATION) {
      const donation = await this.donationRepo.findOne({ where: { id: sourceId } });
      let payerName = donation?.walkInName ?? "";
      if (donation?.memberId) {
        const member = await this.householdService.findMemberByIdOrNull(donation.memberId);
        payerName = member?.name ?? "";
      }
      // 指定捐給某個活動的捐款，項目說明改用「{活動名稱} 捐款」，讓它在收據與報表上跟一般捐款分開辨識
      let description = donation ? LanternService.donationTypeLabel[donation.type] : "油香捐款";
      if (donation?.ceremonyId) {
        const ceremony = await this.ceremonyRepo.findOne({ where: { id: donation.ceremonyId } });
        if (ceremony) description = `${ceremony.name} 捐款`;
      }
      const note = donation?.customItem
        ? `項目：${donation.customItem}${donation.quantity ? ` x${donation.quantity}` : ""}`
        : undefined;
      return { payerName, description, note };
    }
    if (sourceType === ReceiptSourceType.LANTERN_CLAIM) {
      const claim = await this.claimRepo.findOne({ where: { id: sourceId } });
      if (!claim) return { payerName: "", description: "" };
      const slot = await this.slotRepo.findOne({ where: { id: claim.slotId } });
      const wall = slot ? await this.wallRepo.findOne({ where: { id: slot.wallId } }) : null;
      const member = claim.memberId ? await this.householdService.findMemberByIdOrNull(claim.memberId) : null;
      return {
        payerName: member?.name ?? claim.walkInName ?? "",
        description: claim.lanternType || wall?.name || "點燈",
        note: slot ? `燈位：${slot.code}` : undefined,
      };
    }
    return { payerName: "", description: "" };
  }

  async getPrintableReceipt(receiptId: string) {
    const core = await this.getReceiptCore(receiptId);
    const { payerName, description } = await this.describeLanternSource(core.sourceType, core.sourceId);
    return { ...core, payerName, description };
  }

  async getPrintableLabel(claimId: string) {
    const claim = await this.claimRepo.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException("找不到認領紀錄");
    const slot = await this.slotRepo.findOne({ where: { id: claim.slotId } });
    const wall = slot ? await this.wallRepo.findOne({ where: { id: slot.wallId } }) : null;
    const member = claim.memberId ? await this.householdService.findMemberByIdOrNull(claim.memberId) : null;
    return {
      wallName: wall?.name ?? "",
      slotCode: slot?.code ?? "",
      memberName: member?.name ?? claim.walkInName ?? "",
      year: claim.year,
      wishText: claim.wishText ?? "",
      petitionText: claim.petitionText ?? "",
    };
  }

  async findHistoryByMemberId(memberId: string): Promise<MemberHistoryEntryDto[]> {
    const [donations, claims] = await Promise.all([
      this.donationRepo.find({ where: { memberId }, order: { createdAt: "DESC" } }),
      this.claimRepo.find({ where: { memberId }, order: { createdAt: "DESC" } }),
    ]);

    // 排除收據已作廢的項目，不讓已作廢的捐款/點燈紀錄留在信徒歷史紀錄裡
    const [voidedDonationIds, voidedClaimIds] = await Promise.all([
      this.getVoidedSourceIds(
        ReceiptSourceType.DONATION,
        donations.map((d) => d.id),
      ),
      this.getVoidedSourceIds(
        ReceiptSourceType.LANTERN_CLAIM,
        claims.map((c) => c.id),
      ),
    ]);

    const donationEntries: MemberHistoryEntryDto[] = donations
      .filter((d) => !voidedDonationIds.has(d.id))
      .map((d) => ({
        type: "DONATION",
        id: d.id,
        description: LanternService.donationTypeLabel[d.type],
        amount: Number(d.amount),
        occurredAt: d.createdAt.toISOString(),
      }));

    const activeClaims = claims.filter((c) => !voidedClaimIds.has(c.id));
    const slotIds = activeClaims.map((c) => c.slotId);
    const slots = slotIds.length ? await this.slotRepo.find({ where: { id: In(slotIds) } }) : [];
    const slotById = new Map(slots.map((s) => [s.id, s]));

    const claimEntries: MemberHistoryEntryDto[] = activeClaims.map((c) => ({
      type: "LANTERN_CLAIM",
      id: c.id,
      description: `點燈（燈位 ${slotById.get(c.slotId)?.code ?? c.slotId}，${c.year} 年）`,
      amount: Number(c.amount),
      occurredAt: c.createdAt.toISOString(),
    }));

    return [...donationEntries, ...claimEntries].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
  }

  /** 供其他業務模組（如活動報名）核發收據，統一由 Lantern 模組管理收據序號與稽核紀錄 */
  async issueReceipt(
    sourceType: ReceiptSourceType,
    sourceId: string,
    amount: number,
    userId: string,
    issuedByName: string,
    templeId: string,
  ): Promise<ReceiptDto> {
    const receiptNo = this.generateReceiptNo();
    const receipt = this.receiptRepo.create({
      receiptNo,
      sourceType,
      sourceId,
      templeId,
      amount: amount.toFixed(2),
      status: ReceiptStatus.ISSUED,
      issuedByUserId: userId,
    });
    const saved = await this.receiptRepo.save(receipt);
    await this.auditLogRepo.save(
      this.auditLogRepo.create({ receiptId: saved.id, action: "ISSUE", performedByUserId: userId, reason: null }),
    );
    return this.toReceiptDto(saved, issuedByName);
  }

  /**
   * 供「活動報名」頁使用：把同一次櫃台服務中勾選的多項活動（點燈／捐款收費／活動報名）
   * 合併開立成單一張收據，金額加總，並保留逐項說明供列印時列出。
   */
  async issueCombinedReceipt(
    items: ReceiptItemDto[],
    payerName: string,
    userId: string,
    templeId: string,
  ): Promise<ReceiptDto> {
    const receiptNo = this.generateReceiptNo();
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const receipt = this.receiptRepo.create({
      receiptNo,
      sourceType: ReceiptSourceType.COMBINED,
      sourceId: null,
      templeId,
      amount: totalAmount.toFixed(2),
      status: ReceiptStatus.ISSUED,
      issuedByUserId: userId,
      payerName,
      items,
    });
    const saved = await this.receiptRepo.save(receipt);
    await this.auditLogRepo.save(
      this.auditLogRepo.create({ receiptId: saved.id, action: "ISSUE", performedByUserId: userId, reason: null }),
    );
    const issuer = await this.userRepo.findOne({ where: { id: userId } });
    return this.toReceiptDto(saved, issuer?.displayName ?? "");
  }

  private generateReceiptNo(): string {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.floor(Math.random() * 900000 + 100000);
    return `R${datePart}${rand}`;
  }

  private toWallDto(
    wall: LanternWall,
    stats?: { slotCount: number; claimedCount: number; totalAmount: number },
  ): LanternWallDto {
    return {
      id: wall.id,
      templeId: wall.templeId,
      name: wall.name,
      year: wall.year,
      slotPrice: Number(wall.slotPrice),
      slotCount: stats?.slotCount ?? 0,
      claimedCount: stats?.claimedCount ?? 0,
      totalAmount: stats?.totalAmount ?? 0,
      isTaisuiWall: wall.isTaisuiWall,
    };
  }

  private toSlotDto(
    slot: LanternSlot,
    claim: LanternClaim | undefined,
    memberMap: Map<string, { name: string }>,
  ): LanternSlotDto {
    return {
      id: slot.id,
      wallId: slot.wallId,
      code: slot.code,
      row: slot.row,
      column: slot.column,
      status: claim ? LanternSlotStatus.CLAIMED : LanternSlotStatus.EMPTY,
      claim: claim
        ? {
            id: claim.id,
            memberId: claim.memberId,
            memberName: claim.memberId
              ? (memberMap.get(claim.memberId)?.name ?? "未知信徒")
              : (claim.walkInName ?? ""),
            wishText: claim.wishText,
            petitionText: claim.petitionText,
            lanternType: claim.lanternType,
            amount: Number(claim.amount),
          }
        : undefined,
    };
  }

  private toDonationDto(donation: Donation): DonationDto {
    return {
      id: donation.id,
      templeId: donation.templeId,
      memberId: donation.memberId,
      walkInName: donation.walkInName,
      type: donation.type,
      amount: Number(donation.amount),
      customItem: donation.customItem,
      quantity: donation.quantity,
      ceremonyId: donation.ceremonyId,
      createdAt: donation.createdAt.toISOString(),
    };
  }

  private toReceiptDto(receipt: Receipt, issuedByName: string): ReceiptDto {
    return {
      id: receipt.id,
      receiptNo: receipt.receiptNo,
      sourceType: receipt.sourceType,
      sourceId: receipt.sourceId ?? "",
      amount: Number(receipt.amount),
      status: receipt.status,
      issuedByName,
      createdAt: receipt.createdAt.toISOString(),
      payerName: receipt.payerName ?? undefined,
      items: receipt.items ?? undefined,
    };
  }
}
