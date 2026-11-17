import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * receipts.sourceType 的 enum 補上 GIFT：程式的 ReceiptSourceType 早就有 GIFT，但資料庫的 enum 一直沒有，
 * 一旦把 GIFT 寫進這個欄位，正式環境會直接報錯。同時把 daily_audit_logs 的唯一約束名稱與 entity 對齊
 * （約束內容不變，只是名稱不同），之後 migration:generate 不會再產生多餘的差異。
 */
export class AddGiftToReceiptSourceType1785770000000 implements MigrationInterface {
    name = 'AddGiftToReceiptSourceType1785770000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."receipts_sourcetype_enum" ADD VALUE IF NOT EXISTS 'GIFT'`);
    }

    public async down(): Promise<void> {
        // PostgreSQL 不支援從 enum 移除值；多出一個沒人使用的 GIFT 值不會造成任何問題，故還原時不處理
    }
}
