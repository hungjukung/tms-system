import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewDonationTypes1783583698268 implements MigrationInterface {
    name = 'AddNewDonationTypes1783583698268'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."donations_type_enum" ADD VALUE IF NOT EXISTS 'GENERAL'`);
        await queryRunner.query(`ALTER TYPE "public"."donations_type_enum" ADD VALUE IF NOT EXISTS 'PUDU'`);
        await queryRunner.query(`ALTER TYPE "public"."donations_type_enum" ADD VALUE IF NOT EXISTS 'PILGRIMAGE'`);
        await queryRunner.query(`ALTER TYPE "public"."donations_type_enum" ADD VALUE IF NOT EXISTS 'RENOVATION'`);
        await queryRunner.query(`ALTER TYPE "public"."donations_type_enum" ADD VALUE IF NOT EXISTS 'CONSTRUCTION'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Postgres 不支援直接移除 enum 值；若需回復，須重建型別並搬移資料，此處刻意不做破壞性還原。
    }

}
