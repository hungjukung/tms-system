import { MigrationInterface, QueryRunner } from "typeorm";

/** 進香報名加上搭乘車次；既有的進香報名都算第 1 車（改版前只有一台車的座位圖） */
export class AddBusNumberToRegistrations1785800000000 implements MigrationInterface {
    name = 'AddBusNumberToRegistrations1785800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" ADD "busNumber" integer`);
        await queryRunner.query(`UPDATE "ceremony_registrations" SET "busNumber" = 1 WHERE "ceremonyId" IN (SELECT "id" FROM "ceremonies" WHERE "kind" = 'PILGRIMAGE')`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" DROP COLUMN "busNumber"`);
    }

}
