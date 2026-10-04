import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRegistrarUserRole1785500000000 implements MigrationInterface {
    name = 'AddRegistrarUserRole1785500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'REGISTRAR'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Postgres 不支援直接從 enum 移除值，需重建型別；此為新增角色，暫不提供自動回退
    }

}
