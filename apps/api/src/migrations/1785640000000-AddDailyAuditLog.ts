import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDailyAuditLog1785640000000 implements MigrationInterface {
    name = 'AddDailyAuditLog1785640000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "daily_audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "templeId" uuid NOT NULL, "date" date NOT NULL, "auditedByUserId" character varying NOT NULL, "auditedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_daily_audit_logs_temple_date" UNIQUE ("templeId", "date"), CONSTRAINT "PK_daily_audit_logs" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "daily_audit_logs"`);
    }

}
