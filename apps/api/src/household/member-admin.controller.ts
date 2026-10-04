import { Controller, Delete, Param, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { MemberAdminService } from "./member-admin.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class MemberAdminController {
  constructor(private readonly memberAdminService: MemberAdminService) {}

  @Delete("members/:id")
  @Roles(UserRole.DIRECTOR)
  deleteMember(@Param("id") id: string, @Query("force") force?: string) {
    return this.memberAdminService.deleteMember(id, force === "true");
  }
}
