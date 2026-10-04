import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCustomItemQuantityToDonations1785620000000 implements MigrationInterface {
    name = 'AddCustomItemQuantityToDonations1785620000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "donations" ADD "customItem" text`);
        await queryRunner.query(`ALTER TABLE "donations" ADD "quantity" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "donations" DROP COLUMN "quantity"`);
        await queryRunner.query(`ALTER TABLE "donations" DROP COLUMN "customItem"`);
    }

}
