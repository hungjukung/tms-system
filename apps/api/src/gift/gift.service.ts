import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GiftDto, GiftType } from "@tms/shared";
import { HouseholdService } from "../household/household.service";
import { Ceremony } from "../ceremony/entities/ceremony.entity";
import { Gift } from "./entities/gift.entity";
import { CreateGiftDto } from "./dto/create-gift.dto";

@Injectable()
export class GiftService {
  constructor(
    @InjectRepository(Gift) private readonly giftRepo: Repository<Gift>,
    private readonly householdService: HouseholdService,
  ) {}

  private static readonly giftTypeLabel: Record<GiftType, string> = {
    [GiftType.FLOWERS]: "鮮花",
    [GiftType.LONGEVITY]: "壽桃壽麵",
    [GiftType.WATER]: "水",
    [GiftType.BEER]: "啤酒",
    [GiftType.DRINKS]: "飲料",
    [GiftType.OTHER]: "其他",
  };

  /**
   * 供「活動報名」頁合併收據流程使用：建立送禮紀錄，不核發金額（送禮不需金額），但一樣併入合併收據列印。
   * 一次可選多個品項並各自填寫數量，各自建立一筆送禮紀錄，收據上合併成單一「送禮」項目，品項與數量列在備註中。
   */
  async createGiftForCombined(
    dto: CreateGiftDto,
    userId: string,
  ): Promise<{ gifts: GiftDto[]; payerName: string; description: string; note: string; templeId: string }> {
    if (!dto.memberId && !dto.walkInName?.trim()) {
      throw new BadRequestException("請選擇信徒或填寫送禮人姓名");
    }
    if (dto.memberId) {
      await this.householdService.findMemberById(dto.memberId);
    }
    if (dto.ceremonyId) {
      const ceremony = await this.giftRepo.manager.findOne(Ceremony, { where: { id: dto.ceremonyId } });
      if (!ceremony) throw new NotFoundException("找不到活動");
    }
    const gifts = this.giftRepo.create(
      dto.items.map((item) => ({
        templeId: dto.templeId,
        memberId: dto.memberId ?? null,
        walkInName: dto.walkInName ?? null,
        giftType: item.giftType,
        quantity: item.quantity,
        ceremonyId: dto.ceremonyId ?? null,
        createdByUserId: userId,
      })),
    );
    const saved = await this.giftRepo.save(gifts);

    let payerName = dto.walkInName ?? "";
    if (dto.memberId) {
      const member = await this.householdService.findMemberByIdOrNull(dto.memberId);
      payerName = member?.name ?? "";
    }

    return {
      gifts: saved.map((g) => this.toGiftDto(g)),
      payerName,
      description: "送禮",
      note: `品項：${dto.items.map((item) => `${GiftService.giftTypeLabel[item.giftType]}x${item.quantity}`).join("、")}`,
      templeId: dto.templeId,
    };
  }

  /** 合併收據送出失敗時，把這次已建立、還沒開收據的送禮紀錄刪掉 */
  async cancelGifts(giftIds: string[]): Promise<void> {
    if (giftIds.length === 0) return;
    await this.giftRepo.delete(giftIds);
  }

  private toGiftDto(gift: Gift): GiftDto {
    return {
      id: gift.id,
      templeId: gift.templeId,
      memberId: gift.memberId,
      walkInName: gift.walkInName,
      giftType: gift.giftType,
      quantity: gift.quantity,
      ceremonyId: gift.ceremonyId ?? null,
      createdAt: gift.createdAt.toISOString(),
    };
  }
}
