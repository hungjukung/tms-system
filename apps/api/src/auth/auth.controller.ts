import { Body, Controller, Patch, Post, UseGuards } from "@nestjs/common";
import { LoginResponse } from "@tms/shared";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import { RequestUser } from "./jwt-payload.interface";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { UpdateOwnProfileDto } from "./dto/update-own-profile.dto";
import { ChangeOwnPasswordDto } from "./dto/change-own-password.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto.username, dto.password);
  }

  /** 使用者自己編輯自己的帳號資料（任何登入角色皆可，僅限本人） */
  @Patch("me")
  @UseGuards(JwtAuthGuard)
  updateOwnProfile(@Body() dto: UpdateOwnProfileDto, @CurrentUser() user: RequestUser) {
    return this.authService.updateOwnProfile(user.userId, dto);
  }

  /** 使用者自己變更密碼（需驗證目前密碼） */
  @Post("me/change-password")
  @UseGuards(JwtAuthGuard)
  changeOwnPassword(@Body() dto: ChangeOwnPasswordDto, @CurrentUser() user: RequestUser) {
    return this.authService.changeOwnPassword(user.userId, dto.currentPassword, dto.newPassword);
  }
}
