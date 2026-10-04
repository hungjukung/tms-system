import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { QueryFailedError, Repository } from "typeorm";
import {
  AuthUser,
  CreateUserAccountRequest,
  LoginResponse,
  UpdateOwnProfileRequest,
  UpdateUserAccountRequest,
  UserAccountDto,
} from "@tms/shared";
import { User } from "./entities/user.entity";
import { JwtPayload } from "./jwt-payload.interface";

const PG_UNIQUE_VIOLATION = "23505";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async login(username: string, password: string): Promise<LoginResponse> {
    const user = await this.userRepository.findOne({ where: { username } });
    if (!user || !user.active) {
      throw new UnauthorizedException("帳號或密碼錯誤");
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("帳號或密碼錯誤");
    }
    const payload: JwtPayload = { sub: user.id, username: user.username, role: user.role };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }

  /** 供總幹事管理帳號權限使用：列出所有帳號（不含密碼雜湊） */
  async listUsers(): Promise<UserAccountDto[]> {
    const users = await this.userRepository.find({ order: { createdAt: "ASC" } });
    return users.map((u) => this.toUserAccountDto(u));
  }

  async createUserAccount(dto: CreateUserAccountRequest): Promise<UserAccountDto> {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepository.create({
      username: dto.username,
      passwordHash,
      displayName: dto.displayName,
      role: dto.role,
    });
    try {
      const saved = await this.userRepository.save(user);
      return this.toUserAccountDto(saved);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("此帳號已被使用，請換一個帳號名稱");
      }
      throw err;
    }
  }

  /** 供總幹事調整其他帳號的權限（角色）或啟用/停用狀態；不可對自己的帳號降級或停用，避免自己被鎖在系統外 */
  async updateUserAccount(id: string, dto: UpdateUserAccountRequest, currentUserId: string): Promise<UserAccountDto> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException("找不到此帳號");

    if (id === currentUserId) {
      if (dto.role && dto.role !== user.role) {
        throw new ForbiddenException("無法調整自己的權限角色，請由其他總幹事/主委協助調整");
      }
      if (dto.active === false) {
        throw new ForbiddenException("無法停用自己的帳號");
      }
    }

    if (dto.username !== undefined) user.username = dto.username;
    if (dto.displayName !== undefined) user.displayName = dto.displayName;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.active !== undefined) user.active = dto.active;

    try {
      const saved = await this.userRepository.save(user);
      return this.toUserAccountDto(saved);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("此帳號已被使用，請換一個帳號名稱");
      }
      throw err;
    }
  }

  /** 使用者自己編輯自己的帳號資料（帳號/顯示名稱），不含角色與啟用狀態 */
  async updateOwnProfile(userId: string, dto: UpdateOwnProfileRequest): Promise<AuthUser> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("找不到此帳號");

    if (dto.username !== undefined) user.username = dto.username;
    if (dto.displayName !== undefined) user.displayName = dto.displayName;

    try {
      const saved = await this.userRepository.save(user);
      return { id: saved.id, username: saved.username, displayName: saved.displayName, role: saved.role };
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException("此帳號已被使用，請換一個帳號名稱");
      }
      throw err;
    }
  }

  /** 使用者自己變更密碼，需驗證目前密碼正確才能變更 */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("找不到此帳號");

    const currentMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new UnauthorizedException("目前密碼不正確");
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepository.save(user);
  }

  async resetUserPassword(id: string, password: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException("找不到此帳號");
    user.passwordHash = await bcrypt.hash(password, 10);
    await this.userRepository.save(user);
  }

  /** 刪除帳號；不可刪除自己的帳號，避免自己被鎖在系統外 */
  async deleteUserAccount(id: string, currentUserId: string): Promise<void> {
    if (id === currentUserId) {
      throw new ForbiddenException("無法刪除自己的帳號");
    }
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException("找不到此帳號");
    await this.userRepository.remove(user);
  }

  private toUserAccountDto(user: User): UserAccountDto {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
