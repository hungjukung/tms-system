import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import { Storage } from "@google-cloud/storage";

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "uploads", "seals");

/**
 * 存放上傳圖片（目前只有印信/簽章）。有設定 GCS_BUCKET_NAME 時上傳到 Cloud Storage，
 * 本機開發沒設定時退回寫入本機磁碟（維持現有行為），兩種情況都回傳可直接存取的網址。
 */
@Injectable()
export class UploadService {
  private readonly bucketName = process.env.GCS_BUCKET_NAME;
  private readonly storage = this.bucketName ? new Storage() : null;

  async uploadFile(buffer: Buffer, originalName: string, folder = "seals"): Promise<string> {
    const ext = path.extname(originalName).toLowerCase();
    const filename = `${randomUUID()}${ext}`;

    if (this.storage && this.bucketName) {
      const bucket = this.storage.bucket(this.bucketName);
      const objectPath = `${folder}/${filename}`;
      await bucket.file(objectPath).save(buffer, { resumable: false });
      return `https://storage.googleapis.com/${this.bucketName}/${objectPath}`;
    }

    fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_UPLOAD_DIR, filename), buffer);
    return `/uploads/seals/${filename}`;
  }
}
