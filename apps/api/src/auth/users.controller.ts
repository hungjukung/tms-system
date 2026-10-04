import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@tms/shared";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { Roles } from "./decorators/roles.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import { RequestUser } from "./jwt-payload.interface";
import { AuthService } from "./auth.service";
import { CreateUserAccountDto } from "./dto/create-user-account.dto";
import { UpdateUserAccountDto } from "./dto/update-user-account.dto";
import { ResetUserPasswordDto } from "./dto/reset-user-password.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("auth/users")
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @Roles(UserRole.DIRECTOR)
  listUsers() {
    return this.authService.listUsers();
  }

  @Post()
  @Roles(UserRole.DIRECTOR)
  createUser(@Body() dto: CreateUserAccountDto) {
    return this.authService.createUserAccount(dto);
  }

  @Patch(":id")
  @Roles(UserRole.DIRECTOR)
  updateUser(@Param("id") id: string, @Body() dto: UpdateUserAccountDto, @CurrentUser() user: RequestUser) {
    return this.authService.updateUserAccount(id, dto, user.userId);
  }

  @Post(":id/reset-password")
  @Roles(UserRole.DIRECTOR)
  resetPassword(@Param("id") id: string, @Body() dto: ResetUserPasswordDto) {
    return this.authService.resetUserPassword(id, dto.password);
  }

  @Delete(":id")
  @Roles(UserRole.DIRECTOR)
  deleteUser(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.authService.deleteUserAccount(id, user.userId);
  }
}
