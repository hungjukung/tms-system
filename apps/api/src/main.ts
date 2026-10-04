import "reflect-metadata";
import * as path from "path";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix("api");
  // Express 預設 JSON body 上限只有 100kb，一鍵匯入信徒等批次資料很容易超過（上百列信徒資料轉成 JSON 就會破百 KB），故放寬上限
  app.useBodyParser("json", { limit: "20mb" });
  app.useBodyParser("urlencoded", { limit: "20mb", extended: true });
  // 本機開發沒設 CORS_ORIGIN 時維持現行「允許任何來源」的開發體驗；
  // 正式環境務必設定 CORS_ORIGIN 為實際前端網域，收緊跨網域存取
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({ origin: corsOrigin ? corsOrigin.split(",") : true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useStaticAssets(path.join(process.cwd(), "uploads"), {
    prefix: "/uploads/",
    setHeaders: (res) => {
      // 讓前端匯出功能可用 html2canvas 擷取印信圖片（跨網域讀取像素需要 CORS 授權）
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`TMS API listening on http://localhost:${port}`);
}
bootstrap();
