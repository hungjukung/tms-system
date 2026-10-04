import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLanternTypeToClaims1785670000000 implements MigrationInterface {
    name = 'AddLanternTypeToClaims1785670000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_claims" ADD "lanternType" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_claims" DROP COLUMN "lanternType"`);
    }

}
