import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWalkInToLanternClaims1783678493621 implements MigrationInterface {
    name = 'AddWalkInToLanternClaims1783678493621'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_claims" ADD "walkInName" character varying`);
        await queryRunner.query(`ALTER TABLE "lantern_claims" ALTER COLUMN "memberId" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_claims" ALTER COLUMN "memberId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "lantern_claims" DROP COLUMN "walkInName"`);
    }

}
