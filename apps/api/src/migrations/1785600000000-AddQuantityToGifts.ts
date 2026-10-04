import { MigrationInterface, QueryRunner } from "typeorm";

export class AddQuantityToGifts1785600000000 implements MigrationInterface {
    name = 'AddQuantityToGifts1785600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "gifts" ADD "quantity" integer NOT NULL DEFAULT 1`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "gifts" DROP COLUMN "quantity"`);
    }

}
