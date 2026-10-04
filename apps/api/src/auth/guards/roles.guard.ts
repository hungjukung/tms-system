import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@tms/shared";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { RequestUser } from "../jwt-payload.interface";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const user: RequestUser | undefined = request.user;
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
