import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDataEntryUserRole1785070219635 implements MigrationInterface {
    name = 'AddDataEntryUserRole1785070219635'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'DATA_ENTRY'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Postgres 不支援直接移除 enum 值；若需回復，須重建型別並搬移資料，此處刻意不做破壞性還原。
    }

}
