import { MigrationInterface, QueryRunner } from "typeorm";

/** 送禮可以指定屬於哪個活動，活動報表的「收禮資訊」依此列出 */
export class AddCeremonyToGifts1785810000000 implements MigrationInterface {
    name = 'AddCeremonyToGifts1785810000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "gifts" ADD "ceremonyId" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "gifts" DROP COLUMN "ceremonyId"`);
    }

}
