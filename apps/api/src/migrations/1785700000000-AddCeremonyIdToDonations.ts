import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCeremonyIdToDonations1785700000000 implements MigrationInterface {
    name = 'AddCeremonyIdToDonations1785700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "donations" ADD "ceremonyId" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "donations" DROP COLUMN "ceremonyId"`);
    }

}
