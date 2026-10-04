import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { BulkImportMembersResponse, HouseholdDto, MemberDto, UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { HouseholdService } from "./household.service";
import { CreateHouseholdDto } from "./dto/create-household.dto";
import { UpdateHouseholdDto } from "./dto/update-household.dto";
import { CreateMemberDto } from "./dto/create-member.dto";
import { UpdateMemberDto } from "./dto/update-member.dto";
import { BulkImportMembersDto } from "./dto/bulk-import-members.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class HouseholdController {
  constructor(private readonly householdService: HouseholdService) {}

  @Post("households")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.DATA_ENTRY, UserRole.REGISTRAR)
  createHousehold(@Body() dto: CreateHouseholdDto): Promise<HouseholdDto> {
    return this.householdService.createHousehold(dto);
  }

  @Get("households")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.DATA_ENTRY, UserRole.REGISTRAR)
  listHouseholds(): Promise<HouseholdDto[]> {
    return this.householdService.listHouseholds();
  }

  /** 整戶報名等流程使用：透過地址或戶內成員姓名搜尋戶籍 */
  @Get("households/search")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.DATA_ENTRY, UserRole.REGISTRAR)
  searchHouseholds(
    @Query("keyword") keyword = "",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.householdService.searchHouseholds(keyword, Number(page), Number(pageSize));
  }

  @Get("households/:id/members")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.DATA_ENTRY, UserRole.REGISTRAR)
  getHouseholdMembers(@Param("id") id: string): Promise<MemberDto[]> {
    return this.householdService.findMembersByHouseholdId(id);
  }

  @Patch("households/:id")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  updateHousehold(@Param("id") id: string, @Body() dto: UpdateHouseholdDto): Promise<HouseholdDto> {
    return this.householdService.updateHousehold(id, dto);
  }

  @Delete("households/:id")
  @Roles(UserRole.DIRECTOR)
  deleteHousehold(@Param("id") id: string): Promise<void> {
    return this.householdService.deleteHousehold(id);
  }

  @Post("members")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.DATA_ENTRY, UserRole.REGISTRAR)
  createMember(@Body() dto: CreateMemberDto): Promise<MemberDto> {
    return this.householdService.createMember(dto);
  }

  @Post("households/import")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.DATA_ENTRY, UserRole.REGISTRAR)
  importMembers(@Body() dto: BulkImportMembersDto): Promise<BulkImportMembersResponse> {
    return this.householdService.importMembers(dto.rows);
  }

  @Get("members")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.DATA_ENTRY, UserRole.REGISTRAR)
  searchMembers(
    @Query("keyword") keyword = "",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.householdService.searchMembers(keyword, Number(page), Number(pageSize));
  }

  @Get("members/:id")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.DATA_ENTRY, UserRole.REGISTRAR)
  getMember(@Param("id") id: string): Promise<MemberDto> {
    return this.householdService.findMemberById(id);
  }

  @Patch("members/:id")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  updateMember(@Param("id") id: string, @Body() dto: UpdateMemberDto): Promise<MemberDto> {
    return this.householdService.updateMember(id, dto);
  }
}
