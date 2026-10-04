import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../entities/user.entity";
import { JwtPayload, RequestUser } from "../jwt-payload.interface";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_SECRET", "dev-secret-change-me"),
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException("帳號不存在或已停用");
    }
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
