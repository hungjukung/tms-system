import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { UserRole } from "@tms/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { SettingsService } from "./settings.service";
import { UploadService } from "./upload.service";
import { UpdateSettingsDto } from "./dto/update-settings.dto";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function sealUploadInterceptor() {
  return FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(new BadRequestException("僅支援 PNG / JPEG / WebP 圖片格式"), false);
        return;
      }
      cb(null, true);
    },
  });
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly uploadService: UploadService,
  ) {}

  /** 廟別切換器用：列出所有廟宇（不含詳細設定內容） */
  @Get("temples")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR, UserRole.REGISTRAR)
  listTemples() {
    return this.settingsService.listTemples();
  }

  @Get("settings/:templeId")
  @Roles(UserRole.VOLUNTEER, UserRole.FINANCE, UserRole.DIRECTOR)
  getSettings(@Param("templeId") templeId: string) {
    return this.settingsService.getSettings(templeId);
  }

  @Put("settings/:templeId")
  @Roles(UserRole.DIRECTOR)
  updateSettings(@Param("templeId") templeId: string, @Body() dto: UpdateSettingsDto) {
    return this.settingsService.updateSettings(templeId, dto);
  }

  @Post("settings/:templeId/temple-seal")
  @Roles(UserRole.DIRECTOR)
  @UseInterceptors(sealUploadInterceptor())
  async uploadTempleSeal(@Param("templeId") templeId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("請選擇圖片檔案");
    const imagePath = await this.uploadService.uploadFile(file.buffer, file.originalname);
    return this.settingsService.updateSealImagePath(templeId, "temple", imagePath);
  }

  @Post("settings/:templeId/chairman-seal")
  @Roles(UserRole.DIRECTOR)
  @UseInterceptors(sealUploadInterceptor())
  async uploadChairmanSeal(@Param("templeId") templeId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("請選擇圖片檔案");
    const imagePath = await this.uploadService.uploadFile(file.buffer, file.originalname);
    return this.settingsService.updateSealImagePath(templeId, "chairman", imagePath);
  }
}
