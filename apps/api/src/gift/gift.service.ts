import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GiftDto, GiftType } from "@tms/shared";
import { HouseholdService } from "../household/household.service";
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
    if (dto.memberId) {
      await this.householdService.findMemberById(dto.memberId);
    }
    const gifts = this.giftRepo.create(
      dto.items.map((item) => ({
        templeId: dto.templeId,
        memberId: dto.memberId ?? null,
        walkInName: dto.walkInName ?? null,
        giftType: item.giftType,
        quantity: item.quantity,
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

  private toGiftDto(gift: Gift): GiftDto {
    return {
      id: gift.id,
      templeId: gift.templeId,
      memberId: gift.memberId,
      walkInName: gift.walkInName,
      giftType: gift.giftType,
      quantity: gift.quantity,
      createdAt: gift.createdAt.toISOString(),
    };
  }
}
