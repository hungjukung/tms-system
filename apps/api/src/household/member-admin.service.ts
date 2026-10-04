import { ConflictException, Injectable } from "@nestjs/common";
import { HouseholdService } from "./household.service";
import { LanternService } from "../lantern/lantern.service";
import { CeremonyService } from "../ceremony/ceremony.service";

/**
 * 信徒刪除需要先確認 Lantern（油香/點燈）與 Ceremony（活動報名）模組是否有相關歷史紀錄，
 * 但 HouseholdModule 是 Lantern/Ceremony 的依賴基礎，不能反向依賴它們，
 * 所以另外用這個組合層（跟 PrintModule 組合多個模組的做法一致）來處理跨模組檢查。
 */
@Injectable()
export class MemberAdminService {
  constructor(
    private readonly householdService: HouseholdService,
    private readonly lanternService: LanternService,
    private readonly ceremonyService: CeremonyService,
  ) {}

  async deleteMember(id: string, force = false): Promise<void> {
    await this.householdService.findMemberById(id); // 確認信徒存在，否則丟 404

    const [lanternHistory, ceremonyHistory] = await Promise.all([
      this.lanternService.findHistoryByMemberId(id),
      this.ceremonyService.findHistoryByMemberId(id),
    ]);
    const historyCount = lanternHistory.length + ceremonyHistory.length;

    if (historyCount > 0 && !force) {
      throw new ConflictException({
        message: `此信徒已有 ${historyCount} 筆捐款/點燈/活動報名紀錄，確定要刪除嗎？`,
        historyCount,
      });
    }

    // 強制刪除：信徒資料本身會移除，但已核發的收據金額仍保留在財務紀錄中，
    // 只是收據上的信眾姓名之後會顯示為空（因來源信徒已不存在）
    await this.householdService.deleteMemberRow(id);
  }
}
