import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@tms/shared";
import { RolesGuard } from "../../src/auth/guards/roles.guard";

/**
 * 白箱：RolesGuard.canActivate 的每一條路徑
 *   1. VIEWER + GET → 放行        2. VIEWER + 非 GET → 403
 *   3. 端點沒設定 @Roles → 放行    4. DIRECTOR → 一律放行
 *   5. 角色在名單內 → 放行         6. 角色不在名單內 → 403      7. 沒有使用者 → 403
 */
describe("RolesGuard", () => {
  const build = (requiredRoles: UserRole[] | undefined, user: { role: UserRole } | undefined, method = "GET") => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(requiredRoles) } as unknown as Reflector;
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    return { guard: new RolesGuard(reflector), context, reflector };
  };

  it("唯讀帳號 + GET：放行，而且不看端點的角色名單", () => {
    const { guard, context, reflector } = build([UserRole.DIRECTOR], { role: UserRole.VIEWER }, "GET");
    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])("唯讀帳號 + %s：403，即使端點沒有設定角色限制", (method) => {
    const { guard, context } = build(undefined, { role: UserRole.VIEWER }, method);
    expect(() => guard.canActivate(context)).toThrow(new ForbiddenException("此帳號為唯讀帳號，無法執行此操作"));
  });

  it("端點沒有設定 @Roles（undefined）：任何登入者都放行", () => {
    const { guard, context } = build(undefined, { role: UserRole.VOLUNTEER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("端點的 @Roles 是空陣列：任何登入者都放行", () => {
    const { guard, context } = build([], { role: UserRole.DATA_ENTRY }, "POST");
    expect(guard.canActivate(context)).toBe(true);
  });

  it("總幹事：不在名單內也放行", () => {
    const { guard, context } = build([UserRole.FINANCE], { role: UserRole.DIRECTOR }, "DELETE");
    expect(guard.canActivate(context)).toBe(true);
  });

  it("角色在名單內：放行", () => {
    const { guard, context } = build([UserRole.FINANCE, UserRole.VOLUNTEER], { role: UserRole.VOLUNTEER }, "POST");
    expect(guard.canActivate(context)).toBe(true);
  });

  it("角色不在名單內：403", () => {
    const { guard, context } = build([UserRole.FINANCE], { role: UserRole.VOLUNTEER }, "POST");
    expect(() => guard.canActivate(context)).toThrow(new ForbiddenException("權限不足，無法執行此操作"));
  });

  it("請求上沒有使用者（理論上 JwtAuthGuard 會先擋下）：403", () => {
    const { guard, context } = build([UserRole.FINANCE], undefined, "GET");
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
