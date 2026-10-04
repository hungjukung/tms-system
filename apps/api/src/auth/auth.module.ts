import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { UsersController } from "./users.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET", "dev-secret-change-me"),
        signOptions: { expiresIn: "12h" },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController, UsersController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
