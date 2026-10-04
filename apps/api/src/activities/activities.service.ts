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
   * 座位/燈位的孤兒資料。若任何一步失敗（例如燈位/座位被搶先選走），會把這次送出過程中已經建立的
   * 點燈/報名紀錄清乾淨再回報錯誤，不會留下部分成功的殘留資料。
   */
  async submit(dto: SubmitActivitiesDto, userId: string, userRole: UserRole): Promise<SubmitActivitiesResponse> {
    const items: ReceiptItemDto[] = [];
    let payerName = "";
    let templeId = "";
    let donation: DonationDto | undefined;
    let gifts: GiftDto[] | undefined;
    let ceremonyRegistration: CeremonyRegistrationDto | undefined;
    let ceremonyRegistrations: CeremonyRegistrationDto[] | undefined;

    const createdClaimIds: string[] = [];
    const createdRegistrationIds: string[] = [];

    try {
      // 點燈與法會報名有座位/燈位衝突風險，優先處理；捐款/送禮沒有這類風險，留到最後
      for (const claimDto of dto.pendingLanternClaims ?? []) {
        const result = await this.lanternService.claimSlotForCombined(claimDto, userId);
        createdClaimIds.push(result.claimId);
        items.push({
          description: result.description,
          amount: claimDto.amount,
          note: result.note,
          sourceRefs: [{ sourceType: ReceiptSourceType.LANTERN_CLAIM, sourceId: result.claimId }],
        });
        payerName = payerName || result.payerName;
        templeId = templeId || result.templeId;
      }

      for (const householdDto of dto.pendingHouseholdLanternClaims ?? []) {
        const result = await this.lanternService.claimSlotsForHouseholdCombined(householdDto, userId);
        createdClaimIds.push(...result.claimIds);
        items.push({
          description: result.description,
          amount: householdDto.amount,
          note: result.note,
          sourceRefs: result.claimIds.map((id) => ({ sourceType: ReceiptSourceType.LANTERN_CLAIM, sourceId: id })),
        });
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

      if (dto.donation) {
        const result = await this.lanternService.createDonationForCombined(dto.donation, userId, userRole);
        donation = result.donation;
        items.push({
          description: result.description,
          amount: dto.donation.amount,
          note: result.note,
          sourceRefs: [{ sourceType: ReceiptSourceType.DONATION, sourceId: donation.id }],
        });
        payerName = payerName || result.payerName;
        templeId = templeId || dto.donation.templeId;
      }

      if (dto.gift) {
        const result = await this.giftService.createGiftForCombined(dto.gift, userId);
        gifts = result.gifts;
        items.push({
          description: result.description,
          amount: 0,
          note: result.note,
          sourceRefs: gifts.map((g) => ({ sourceType: ReceiptSourceType.GIFT, sourceId: g.id })),
        });
        payerName = payerName || result.payerName;
        templeId = templeId || result.templeId;
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
      return { receipt, donation, gifts, ceremonyRegistration, ceremonyRegistrations };
    } catch (err) {
      await Promise.all([
        ...createdClaimIds.map((id) => this.lanternService.cancelClaim(id).catch(() => undefined)),
        ...createdRegistrationIds.map((id) => this.ceremonyService.cancelRegistration(id).catch(() => undefined)),
      ]);
      throw err;
    }
  }
}
