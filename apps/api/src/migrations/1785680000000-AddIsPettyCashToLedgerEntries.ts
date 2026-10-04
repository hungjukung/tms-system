import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsPettyCashToLedgerEntries1785680000000 implements MigrationInterface {
    name = 'AddIsPettyCashToLedgerEntries1785680000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ledger_entries" ADD "isPettyCash" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ledger_entries" DROP COLUMN "isPettyCash"`);
    }

}
