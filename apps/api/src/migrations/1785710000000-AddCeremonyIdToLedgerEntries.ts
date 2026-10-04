import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCeremonyIdToLedgerEntries1785710000000 implements MigrationInterface {
    name = 'AddCeremonyIdToLedgerEntries1785710000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ledger_entries" ADD "ceremonyId" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ledger_entries" DROP COLUMN "ceremonyId"`);
    }

}
