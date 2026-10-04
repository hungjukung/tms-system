import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPettyCashResetAtToTemples1785690000000 implements MigrationInterface {
    name = 'AddPettyCashResetAtToTemples1785690000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "temples" ADD "pettyCashResetAt" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "temples" DROP COLUMN "pettyCashResetAt"`);
    }

}
