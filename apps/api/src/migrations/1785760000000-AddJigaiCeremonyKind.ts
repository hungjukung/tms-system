import { MigrationInterface, QueryRunner } from "typeorm";

/** 新增「祭改」活動種類：活動加上 kind／上下午場人數上限，報名加上場次與場次號碼（同活動同場次號碼不可重複） */
export class AddJigaiCeremonyKind1785760000000 implements MigrationInterface {
    name = 'AddJigaiCeremonyKind1785760000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremonies" ADD "kind" character varying NOT NULL DEFAULT 'GENERAL'`);
        await queryRunner.query(`ALTER TABLE "ceremonies" ADD "morningCapacity" integer`);
        await queryRunner.query(`ALTER TABLE "ceremonies" ADD "afternoonCapacity" integer`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" ADD "session" character varying`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" ADD "queueNumber" integer`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" ADD CONSTRAINT "uq_ceremony_session_number" UNIQUE ("ceremonyId", "session", "queueNumber")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" DROP CONSTRAINT "uq_ceremony_session_number"`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" DROP COLUMN "queueNumber"`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" DROP COLUMN "session"`);
        await queryRunner.query(`ALTER TABLE "ceremonies" DROP COLUMN "afternoonCapacity"`);
        await queryRunner.query(`ALTER TABLE "ceremonies" DROP COLUMN "morningCapacity"`);
        await queryRunner.query(`ALTER TABLE "ceremonies" DROP COLUMN "kind"`);
    }

}
