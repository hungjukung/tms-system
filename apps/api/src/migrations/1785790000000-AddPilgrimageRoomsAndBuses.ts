import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 進香改成「房型 + 間數 + 遊覽車台數」：活動加上遊覽車台數（既有進香活動原本就是一台車的座位圖，設為 1 台），
 * 報名加上所訂房型與第幾間，用來計算每個房型已訂幾間。
 */
export class AddPilgrimageRoomsAndBuses1785790000000 implements MigrationInterface {
    name = 'AddPilgrimageRoomsAndBuses1785790000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremonies" ADD "busCount" integer`);
        await queryRunner.query(`UPDATE "ceremonies" SET "busCount" = 1 WHERE "kind" = 'PILGRIMAGE'`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" ADD "roomType" character varying`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" ADD "roomNumber" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" DROP COLUMN "roomNumber"`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" DROP COLUMN "roomType"`);
        await queryRunner.query(`ALTER TABLE "ceremonies" DROP COLUMN "busCount"`);
    }

}
