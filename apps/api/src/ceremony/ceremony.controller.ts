import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequestUser } from "../auth/jwt-payload.interface";
import { CeremonyService } from "./ceremony.service";
import { CreateCeremonyDto } from "./dto/create-ceremony.dto";
import { UpdateCeremonyDto } from "./dto/update-ceremony.dto";
import { RegisterCeremonyDto } from "./dto/register-ceremony.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("ceremony")
export class CeremonyController {
  constructor(private readonly ceremonyService: CeremonyService) {}

  @Post("ceremonies")
  @Roles(UserRole.DIRECTOR)
  createCeremony(@Body() dto: CreateCeremonyDto) {
    return this.ceremonyService.createCeremony(dto);
  }

  @Get("ceremonies")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  listCeremonies(@Query("templeId") templeId?: string, @Query("activeOnly") activeOnly?: string) {
    return this.ceremonyService.listCeremonies(templeId, activeOnly === "true");
  }

  @Patch("ceremonies/:id")
  @Roles(UserRole.DIRECTOR)
  updateCeremony(@Param("id") id: string, @Body() dto: UpdateCeremonyDto) {
    return this.ceremonyService.updateCeremony(id, dto);
  }

  @Delete("ceremonies/:id")
  @Roles(UserRole.DIRECTOR)
  deleteCeremony(@Param("id") id: string, @Query("force") force?: string) {
    return this.ceremonyService.deleteCeremony(id, force === "true");
  }

  @Get("ceremonies/:id/seats")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  getSeatMap(@Param("id") id: string) {
    return this.ceremonyService.getSeatMap(id);
  }

  /** 供財務管理「活動查詢」與「建立活動」頁活動詳情使用 */
  @Get("ceremonies/:id/report")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  getCeremonyReport(@Param("id") id: string) {
    return this.ceremonyService.getCeremonyReport(id);
  }

  @Post("registrations")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  register(@Body() dto: RegisterCeremonyDto, @CurrentUser() user: RequestUser) {
    return this.ceremonyService.register(dto, user.userId);
  }

  /** 供「活動報名」頁一次報名多個活動使用：選位/報名當下就先建立紀錄，收據留待與其他活動合併開立 */
  @Post("registrations/combined")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  registerForCombined(@Body() dto: RegisterCeremonyDto, @CurrentUser() user: RequestUser) {
    return this.ceremonyService.createRegistrationForCombined(dto, user.userId);
  }

  /** 供「活動報名」頁在送出並開立收據前，從加入清單中移除某筆尚未送出的報名項目使用 */
  @Delete("registrations/:id")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  cancelRegistration(@Param("id") id: string) {
    return this.ceremonyService.cancelRegistration(id);
  }

  @Get("members/:memberId/history")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  getMemberHistory(@Param("memberId") memberId: string) {
    return this.ceremonyService.findHistoryByMemberId(memberId);
  }
}
