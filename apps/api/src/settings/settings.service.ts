import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TempleDto, TempleSettingsDto } from "@tms/shared";
import { Temple } from "./entities/temple.entity";
import { UpdateSettingsDto } from "./dto/update-settings.dto";

@Injectable()
export class SettingsService {
  constructor(@InjectRepository(Temple) private readonly templeRepo: Repository<Temple>) {}

  /** 供廟別切換器使用：列出所有廟宇（僅 id/name，不含詳細設定） */
  async listTemples(): Promise<TempleDto[]> {
    const temples = await this.templeRepo.find({ order: { createdAt: "ASC" } });
    return temples.map((t) => ({ id: t.id, name: t.name }));
  }

  private async findTempleOrThrow(templeId: string): Promise<Temple> {
    const temple = await this.templeRepo.findOne({ where: { id: templeId } });
    if (!temple) throw new NotFoundException("找不到此廟宇設定");
    return temple;
  }

  async getSettings(templeId: string): Promise<TempleSettingsDto> {
    const temple = await this.findTempleOrThrow(templeId);
    return this.toDto(temple);
  }

  async updateSettings(templeId: string, dto: UpdateSettingsDto): Promise<TempleSettingsDto> {
    const temple = await this.findTempleOrThrow(templeId);
    Object.assign(temple, dto);
    const saved = await this.templeRepo.save(temple);
    return this.toDto(saved);
  }

  async updateSealImagePath(
    templeId: string,
    kind: "temple" | "chairman",
    imagePath: string,
  ): Promise<TempleSettingsDto> {
    const temple = await this.findTempleOrThrow(templeId);
    if (kind === "temple") {
      temple.templeSealImagePath = imagePath;
    } else {
      temple.chairmanSealImagePath = imagePath;
    }
    const saved = await this.templeRepo.save(temple);
    return this.toDto(saved);
  }

  private toDto(temple: Temple): TempleSettingsDto {
    return {
      id: temple.id,
      name: temple.name,
      templeName: temple.templeName,
      address: temple.address,
      phone: temple.phone,
      registrationNo: temple.registrationNo,
      taxId: temple.taxId,
      committeeName: temple.committeeName,
      chairmanTitle: temple.chairmanTitle,
      chairmanName: temple.chairmanName,
      templeSealImagePath: temple.templeSealImagePath,
      chairmanSealImagePath: temple.chairmanSealImagePath,
    };
  }
}
