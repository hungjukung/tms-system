import { MigrationInterface, QueryRunner } from "typeorm";

export class ConvertLedgerEntryCategoryToText1785630000000 implements MigrationInterface {
    name = 'ConvertLedgerEntryCategoryToText1785630000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ledger_entries" ALTER COLUMN "category" TYPE character varying(100) USING "category"::text`);
        await queryRunner.query(`DROP TYPE "public"."ledger_entries_category_enum"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."ledger_entries_category_enum" AS ENUM('PAPER_MONEY_SALES', 'EXTERNAL_DONATION', 'OTHER_INCOME', 'UTILITIES', 'RITUAL_MASTER_FEE', 'REPAIR', 'OFFERING_SUPPLIES', 'OTHER_EXPENSE')`);
        await queryRunner.query(`ALTER TABLE "ledger_entries" ALTER COLUMN "category" TYPE "public"."ledger_entries_category_enum" USING "category"::"public"."ledger_entries_category_enum"`);
    }

}
