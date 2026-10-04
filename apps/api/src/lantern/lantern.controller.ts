import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ReceiptSourceType, UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequestUser } from "../auth/jwt-payload.interface";
import { LanternService } from "./lantern.service";
import { ClaimSlotDto } from "./dto/claim-slot.dto";
import { UpdateLanternClaimDto } from "./dto/update-claim.dto";
import { ClaimHouseholdSlotsDto } from "./dto/claim-household-slots.dto";
import { CreateDonationDto } from "./dto/create-donation.dto";
import { CreateWallDto, GenerateSlotsDto, UpdateWallDto } from "./dto/create-wall.dto";
import { VoidReceiptDto } from "./dto/void-receipt.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class LanternController {
  constructor(private readonly lanternService: LanternService) {}

  @Post("lantern/walls")
  @Roles(UserRole.DIRECTOR)
  createWall(@Body() dto: CreateWallDto) {
    return this.lanternService.createWall(dto);
  }

  @Get("lantern/walls")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  listWalls(@Query("templeId") templeId?: string) {
    return this.lanternService.listWalls(templeId);
  }

  /** 修改燈牆的點燈內容（例如「光明燈」「平安燈」） */
  @Patch("lantern/walls/:id")
  @Roles(UserRole.DIRECTOR)
  updateWall(@Param("id") id: string, @Body() dto: UpdateWallDto) {
    return this.lanternService.updateWall(id, dto);
  }

  /** 刪除燈牆（連同底下所有燈位）；已有信眾點燈時需帶 force=true 二次確認才會一併刪除 */
  @Delete("lantern/walls/:id")
  @Roles(UserRole.DIRECTOR)
  deleteWall(@Param("id") id: string, @Query("force") force?: string) {
    return this.lanternService.deleteWall(id, force === "true");
  }

  @Post("lantern/walls/:wallId/slots")
  @Roles(UserRole.DIRECTOR)
  generateSlots(@Param("wallId") wallId: string, @Body() dto: GenerateSlotsDto) {
    return this.lanternService.generateSlots(wallId, dto);
  }

  @Get("lantern/walls/:wallId/slots")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  getWallSlots(@Param("wallId") wallId: string) {
    return this.lanternService.getWallSlots(wallId);
  }

  @Post("lantern/claims")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  claimSlot(@Body() dto: ClaimSlotDto, @CurrentUser() user: RequestUser) {
    return this.lanternService.claimSlot(dto, user.userId);
  }

  /** 供「活動報名」頁合併收據流程使用：選位當下先卡位建立認領紀錄，收據留待與其他活動合併開立 */
  @Post("lantern/claims/combined")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  claimSlotForCombined(@Body() dto: ClaimSlotDto, @CurrentUser() user: RequestUser) {
    return this.lanternService.claimSlotForCombined(dto, user.userId);
  }

  /** 供「活動報名」頁整戶點燈使用：一次認領同一面燈牆上與戶籍人數相同的多個燈位 */
  @Post("lantern/claims/household-combined")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  claimSlotsForHouseholdCombined(@Body() dto: ClaimHouseholdSlotsDto, @CurrentUser() user: RequestUser) {
    return this.lanternService.claimSlotsForHouseholdCombined(dto, user.userId);
  }

  @Patch("lantern/claims/:id")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  updateClaim(@Param("id") id: string, @Body() dto: UpdateLanternClaimDto) {
    return this.lanternService.updateClaim(id, dto);
  }

  /** 供「活動報名」頁在送出並開立收據前，從加入清單中移除某筆尚未送出的點燈項目使用 */
  @Delete("lantern/claims/:id")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  cancelClaim(@Param("id") id: string) {
    return this.lanternService.cancelClaim(id);
  }

  @Post("lantern/donations")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  createDonation(@Body() dto: CreateDonationDto, @CurrentUser() user: RequestUser) {
    return this.lanternService.createDonation(dto, user.userId, user.role);
  }

  /** 供「最近收據」分頁瀏覽使用；有提供 keyword 時依收據編號或信眾姓名模糊搜尋，有提供 sourceType 時依活動類型篩選 */
  @Get("lantern/receipts")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  listReceipts(
    @Query("keyword") keyword?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("sourceType") sourceType?: ReceiptSourceType,
  ) {
    return this.lanternService.listReceipts(keyword, Number(page), Number(pageSize), sourceType);
  }

  @Post("lantern/receipts/:id/void")
  @Roles(UserRole.FINANCE, UserRole.DIRECTOR)
  voidReceipt(
    @Param("id") id: string,
    @Body() dto: VoidReceiptDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.lanternService.voidReceipt(id, dto.reason, user.userId);
  }

  /** 真正從資料庫永久刪除收據（不同於作廢），僅總幹事可操作，無法復原 */
  @Delete("lantern/receipts/:id")
  @Roles(UserRole.DIRECTOR)
  deleteReceipt(@Param("id") id: string) {
    return this.lanternService.deleteReceipt(id);
  }

  @Get("lantern/members/:memberId/history")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  getMemberHistory(@Param("memberId") memberId: string) {
    return this.lanternService.findHistoryByMemberId(memberId);
  }
}
