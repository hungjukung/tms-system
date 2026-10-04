import { UserRole } from "@tms/shared";

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

export interface RequestUser {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
}
