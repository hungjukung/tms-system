import { MigrationInterface, QueryRunner } from "typeorm";

/** 進香活動新增房型清單（名稱、人數、費用） */
export class AddCeremonyRoomTypes1785780000000 implements MigrationInterface {
    name = 'AddCeremonyRoomTypes1785780000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremonies" ADD "roomTypes" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremonies" DROP COLUMN "roomTypes"`);
    }

}
