import { BadRequestException, Injectable } from "@nestjs/common";
import {
  CeremonyRegistrationDto,
  DonationDto,
  GiftDto,
  ReceiptItemDto,
  ReceiptSourceType,
  SubmitActivitiesResponse,
  UserRole,
} from "@tms/shared";
import { LanternService } from "../lantern/lantern.service";
import { CeremonyService } from "../ceremony/ceremony.service";
import { GiftService } from "../gift/gift.service";
import { SubmitActivitiesDto } from "./dto/submit-activities.dto";

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly lanternService: LanternService,
    private readonly ceremonyService: CeremonyService,
    private readonly giftService: GiftService,
  ) {}

  /**
   * 「活動報名」頁一次勾選多個活動（點燈／捐款收費／活動報名／送禮）時，各活動仍各自建立紀錄，
   * 但合併開立成單一張收據、金額加總。點燈／法會報名在此之前只暫存在前端（「加入」不會馬上寫入資料庫），
   * 送出當下才真正卡位／配位並建立紀錄，緊接著開立收據——避免「加入後忘記送出」留下沒有收據、卻佔用
   * 座位/燈位的孤兒資料。若任何一步失敗（例如燈位/座位被搶先選走、送禮指定的活動不存在），會把這次送出過程中
   * 已經建立的點燈/報名/捐款/送禮紀錄清乾淨再回報錯誤，不會留下部分成功的殘留資料。
   */
  async submit(dto: SubmitActivitiesDto, userId: string, userRole: UserRole): Promise<SubmitActivitiesResponse> {
    const items: ReceiptItemDto[] = [];
    let payerName = "";
    let templeId = "";
    const donations: DonationDto[] = [];
    const gifts: GiftDto[] = [];
    let ceremonyRegistration: CeremonyRegistrationDto | undefined;
    let ceremonyRegistrations: CeremonyRegistrationDto[] | undefined;

    const createdClaimIds: string[] = [];
    const createdRegistrationIds: string[] = [];
    const createdDonationIds: string[] = [];
    const createdGiftIds: string[] = [];
    // 記錄每個點燈項目的點燈人，多人點燈時在備註前面加上名字，讓人看得出誰點了哪一盞
    const lanternItems: { item: ReceiptItemDto; payer: string }[] = [];

    try {
      // 點燈與法會報名有座位/燈位衝突風險，優先處理；捐款/送禮沒有這類風險，留到最後
      for (const claimDto of dto.pendingLanternClaims ?? []) {
        const result = await this.lanternService.claimSlotForCombined(claimDto, userId);
        createdClaimIds.push(result.claimId);
        const claimItem: ReceiptItemDto = {
          description: result.description,
          amount: claimDto.amount,
          note: result.note,
          sourceRefs: [{ sourceType: ReceiptSourceType.LANTERN_CLAIM, sourceId: result.claimId }],
        };
        items.push(claimItem);
        lanternItems.push({ item: claimItem, payer: result.payerName });
        payerName = payerName || result.payerName;
        templeId = templeId || result.templeId;
      }

      for (const householdDto of dto.pendingHouseholdLanternClaims ?? []) {
        const result = await this.lanternService.claimSlotsForHouseholdCombined(householdDto, userId);
        createdClaimIds.push(...result.claimIds);
        const householdItem: ReceiptItemDto = {
          description: result.description,
          amount: householdDto.amount,
          note: result.note,
          sourceRefs: result.claimIds.map((id) => ({ sourceType: ReceiptSourceType.LANTERN_CLAIM, sourceId: id })),
        };
        items.push(householdItem);
        lanternItems.push({ item: householdItem, payer: result.payerName });
        payerName = payerName || result.payerName;
        templeId = templeId || result.templeId;
      }

      for (const regDto of dto.pendingCeremonyRegistrations ?? []) {
        const result = await this.ceremonyService.createRegistrationForCombined(regDto, userId);
        const registrations = result.registrations ?? (result.registration ? [result.registration] : []);
        createdRegistrationIds.push(...registrations.map((r) => r.id));
        items.push({
          description: result.description,
          amount: regDto.amount,
          note: result.note,
          category: "CEREMONY_REGISTRATION",
          sourceRefs: registrations.map((r) => ({
            sourceType: ReceiptSourceType.CEREMONY_REGISTRATION,
            sourceId: r.id,
          })),
        });
        payerName = payerName || result.payerName;
        templeId = templeId || result.templeId;
        if (!ceremonyRegistration && !ceremonyRegistrations) {
          ceremonyRegistration = result.registration;
          ceremonyRegistrations = result.registrations;
        }
      }

      // 捐款與送禮可以一次開立多筆：每一筆各自是收據上的一個項目（單筆舊欄位 donation／gift 排在最前面）
      for (const donationDto of [...(dto.donation ? [dto.donation] : []), ...(dto.donations ?? [])]) {
        const result = await this.lanternService.createDonationForCombined(donationDto, userId, userRole);
        createdDonationIds.push(result.donation.id);
        donations.push(result.donation);
        items.push({
          description: result.description,
          amount: donationDto.amount,
          note: result.note,
          sourceRefs: [{ sourceType: ReceiptSourceType.DONATION, sourceId: result.donation.id }],
        });
        payerName = payerName || result.payerName;
        templeId = templeId || donationDto.templeId;
      }

      for (const giftDto of [...(dto.gift ? [dto.gift] : []), ...(dto.gifts ?? [])]) {
        const result = await this.giftService.createGiftForCombined(giftDto, userId);
        createdGiftIds.push(...result.gifts.map((g) => g.id));
        gifts.push(...result.gifts);
        items.push({
          description: result.description,
          amount: 0,
          note: result.note,
          sourceRefs: result.gifts.map((g) => ({ sourceType: ReceiptSourceType.GIFT, sourceId: g.id })),
        });
        payerName = payerName || result.payerName;
        templeId = templeId || result.templeId;
      }

      if (new Set(lanternItems.map((l) => l.payer)).size > 1) {
        for (const { item, payer } of lanternItems) {
          if (payer && item.note) item.note = `${payer}，${item.note}`;
        }
      }

      payerName = payerName || dto.fallbackPayerName || "";
      templeId = templeId || dto.fallbackTempleId || "";

      if (items.length === 0) {
        throw new BadRequestException("尚未填寫任何活動項目");
      }
      if (!templeId) {
        throw new BadRequestException("無法判斷此次收據所屬廟宇");
      }

      const receipt = await this.lanternService.issueCombinedReceipt(items, payerName, userId, templeId);
      return {
        receipt,
        donation: donations[0],
        donations: donations.length ? donations : undefined,
        gifts: gifts.length ? gifts : undefined,
        ceremonyRegistration,
        ceremonyRegistrations,
      };
    } catch (err) {
      await Promise.all([
        ...createdClaimIds.map((id) => this.lanternService.cancelClaim(id).catch(() => undefined)),
        ...createdRegistrationIds.map((id) => this.ceremonyService.cancelRegistration(id).catch(() => undefined)),
        ...createdDonationIds.map((id) => this.lanternService.cancelDonation(id).catch(() => undefined)),
        this.giftService.cancelGifts(createdGiftIds).catch(() => undefined),
      ]);
      throw err;
    }
  }
}
