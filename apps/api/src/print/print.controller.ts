import { Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";
import { ReceiptSourceType, UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { LanternService } from "../lantern/lantern.service";
import { CeremonyService } from "../ceremony/ceremony.service";
import { SettingsService } from "../settings/settings.service";
import { PrintService } from "./print.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("print")
export class PrintController {
  constructor(
    private readonly printService: PrintService,
    private readonly lanternService: LanternService,
    private readonly ceremonyService: CeremonyService,
    private readonly settingsService: SettingsService,
  ) {}

  // TODO（多廟 phase 3）：Receipt 尚未有 templeId，暫時固定用「中埔」的設定列印；
  // Receipt 加上 templeId 後這裡要改成依 receipt 實際所屬廟宇查對應設定。
  private async getInterimTempleId(): Promise<string> {
    const temples = await this.settingsService.listTemples();
    return (temples.find((t) => t.name === "中埔") ?? temples[0])?.id;
  }

  private async buildReceiptData(receiptId: string) {
    const core = await this.lanternService.getReceiptCore(receiptId);
    let payerName: string;
    if (core.sourceType === ReceiptSourceType.COMBINED) {
      payerName = core.payerName ?? "";
    } else if (core.sourceType === ReceiptSourceType.CEREMONY_REGISTRATION) {
      payerName = (await this.ceremonyService.describeRegistration(core.sourceId)).payerName;
    } else {
      payerName = (await this.lanternService.describeLanternSource(core.sourceType, core.sourceId)).payerName;
    }
    const templeId = await this.getInterimTempleId();
    const settings = await this.settingsService.getSettings(templeId);
    return { core, payerName, settings };
  }

  @Get("receipt/:receiptId")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  async printReceipt(@Param("receiptId") receiptId: string, @Req() req: Request, @Res() res: Response) {
    const { core, payerName, settings } = await this.buildReceiptData(receiptId);
    const baseUrl = `${req.protocol}://${req.get("host")}/`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(this.printService.renderReceiptHtml({ ...core, payerName }, settings, baseUrl));
  }

  /** 供前端匯出 Word / Excel 使用：回傳感謝狀的結構化欄位（不含印信圖片） */
  @Get("receipt/:receiptId/data")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  async getReceiptData(@Param("receiptId") receiptId: string) {
    const { core, payerName, settings } = await this.buildReceiptData(receiptId);
    return {
      receiptNo: core.receiptNo,
      amount: core.amount,
      status: core.status,
      createdAt: core.createdAt,
      issuedByName: core.issuedByName,
      payerName,
      items: core.items ?? null,
      templeName: settings.templeName,
      committeeName: settings.committeeName ?? settings.templeName,
      address: settings.address,
      phone: settings.phone,
      registrationNo: settings.registrationNo,
      taxId: settings.taxId,
      chairmanTitle: settings.chairmanTitle,
    };
  }

  /**
   * 供「最近收據」分頁瀏覽／匯出 Excel 使用：附上信眾姓名與項目說明；
   * 有提供 keyword 時依收據編號或信眾姓名模糊搜尋，有提供 sourceType 時依活動類型篩選
   */
  @Get("receipts/details")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  async listReceiptDetails(
    @Query("keyword") keyword?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("sourceType") sourceType?: ReceiptSourceType,
  ) {
    const result = await this.lanternService.listReceipts(keyword, Number(page), Number(pageSize), sourceType);
    const items = await Promise.all(
      result.items.map(async (receipt) => {
        if (receipt.sourceType === ReceiptSourceType.COMBINED) {
          return {
            ...receipt,
            payerName: receipt.payerName ?? "",
            description: (receipt.items ?? []).map((item) => item.description).join("、"),
          };
        }
        const { payerName, description } =
          receipt.sourceType === ReceiptSourceType.CEREMONY_REGISTRATION
            ? await this.ceremonyService.describeRegistration(receipt.sourceId)
            : await this.lanternService.describeLanternSource(receipt.sourceType, receipt.sourceId);
        return { ...receipt, payerName, description };
      }),
    );
    return { items, total: result.total, page: result.page, pageSize: result.pageSize };
  }

  @Get("lantern-label/:claimId")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  async printLanternLabel(@Param("claimId") claimId: string, @Res() res: Response) {
    const data = await this.lanternService.getPrintableLabel(claimId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(this.printService.renderLanternLabelHtml(data));
  }

}
