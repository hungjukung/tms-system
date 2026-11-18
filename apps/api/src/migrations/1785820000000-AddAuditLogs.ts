import { MigrationInterface, QueryRunner } from "typeorm";

/** 操作紀錄：記錄調整進香房型／車次、活動建立修改刪除、永久刪除收據等需要留痕的操作 */
export class AddAuditLogs1785820000000 implements MigrationInterface {
    name = 'AddAuditLogs1785820000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "action" character varying NOT NULL, "entityType" character varying NOT NULL, "entityId" character varying, "summary" text NOT NULL, "performedByUserId" character varying NOT NULL, "templeId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c69efb19bf127c97e6740ad530" ON "audit_logs" ("createdAt")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_c69efb19bf127c97e6740ad530"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
    }

}
