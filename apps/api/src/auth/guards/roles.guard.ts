import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@tms/shared";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { RequestUser } from "../jwt-payload.interface";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;

    // 唯讀帳號（VIEWER）：不管該端點有沒有設定 @Roles()，一律只放行 GET，其餘方法（新增/修改/刪除）直接擋下。
    // 用 HTTP 方法在此統一把關，而不是逐一在每個端點的 @Roles() 清單加上 VIEWER，
    // 避免日後新增端點忘記處理而讓這個角色意外取得寫入權限。
    if (user?.role === UserRole.VIEWER) {
      if (request.method !== "GET") {
        throw new ForbiddenException("此帳號為唯讀帳號，無法執行此操作");
      }
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    // 總幹事/主委擁有所有權限
    if (user?.role === UserRole.DIRECTOR) {
      return true;
    }
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException("權限不足，無法執行此操作");
    }
    return true;
  }
}
