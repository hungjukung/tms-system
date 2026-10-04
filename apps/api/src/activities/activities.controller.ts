import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequestUser } from "../auth/jwt-payload.interface";
import { ActivitiesService } from "./activities.service";
import { SubmitActivitiesDto } from "./dto/submit-activities.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("activities")
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post("submit")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  submit(@Body() dto: SubmitActivitiesDto, @CurrentUser() user: RequestUser) {
    return this.activitiesService.submit(dto, user.userId, user.role);
  }
}
