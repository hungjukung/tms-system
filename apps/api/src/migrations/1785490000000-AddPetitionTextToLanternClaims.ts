import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPetitionTextToLanternClaims1785490000000 implements MigrationInterface {
    name = 'AddPetitionTextToLanternClaims1785490000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_claims" ADD "petitionText" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_claims" DROP COLUMN "petitionText"`);
    }

}
