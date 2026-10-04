import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1783394179138 implements MigrationInterface {
    name = 'InitialSchema1783394179138'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('VOLUNTEER', 'FINANCE', 'DIRECTOR')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying NOT NULL, "passwordHash" character varying NOT NULL, "displayName" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'VOLUNTEER', "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "households" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "address" character varying NOT NULL, "phone" character varying, "headMemberId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2b1aef2640717132e9231aac756" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."members_gender_enum" AS ENUM('MALE', 'FEMALE', 'UNKNOWN')`);
        await queryRunner.query(`CREATE TABLE "members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "householdId" uuid NOT NULL, "name" character varying NOT NULL, "phone" character varying, "address" text, "gender" "public"."members_gender_enum" NOT NULL DEFAULT 'UNKNOWN', "birthDateSolar" date, "birthDateLunar" character varying, "zodiac" character varying, "tags" text array NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_28b53062261b996d9c99fa12404" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2e9903f9aa7c7e15e7d268634a" ON "members" ("name") `);
        await queryRunner.query(`CREATE TABLE "lantern_walls" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "templeId" uuid NOT NULL, "name" character varying NOT NULL, "year" integer NOT NULL, "slotPrice" numeric(10,2) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_098bf4bd71613fd82ab3d975619" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "lantern_slots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "wallId" uuid NOT NULL, "code" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_wall_code" UNIQUE ("wallId", "code"), CONSTRAINT "PK_4d5a68d3fbae977dd5f68deb2a1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_149a0d45bff02c223653480b5b" ON "lantern_slots" ("wallId") `);
        await queryRunner.query(`CREATE TABLE "lantern_claims" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slotId" uuid NOT NULL, "year" integer NOT NULL, "memberId" character varying NOT NULL, "wishText" text, "amount" numeric(10,2) NOT NULL, "createdByUserId" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_slot_year" UNIQUE ("slotId", "year"), CONSTRAINT "PK_a8aea40a57efbfcba3252fa5872" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."donations_type_enum" AS ENUM('YOU_XIANG', 'SUI_XI', 'CEREMONY', 'OTHER')`);
        await queryRunner.query(`CREATE TABLE "donations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "templeId" uuid NOT NULL, "memberId" uuid, "walkInName" character varying, "type" "public"."donations_type_enum" NOT NULL, "amount" numeric(10,2) NOT NULL, "note" text, "createdByUserId" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c01355d6f6f50fc6d1b4a946abf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."receipts_sourcetype_enum" AS ENUM('LANTERN_CLAIM', 'DONATION', 'CEREMONY_REGISTRATION', 'COMBINED')`);
        await queryRunner.query(`CREATE TYPE "public"."receipts_status_enum" AS ENUM('ISSUED', 'VOIDED')`);
        await queryRunner.query(`CREATE TABLE "receipts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "templeId" uuid NOT NULL, "receiptNo" character varying NOT NULL, "sourceType" "public"."receipts_sourcetype_enum" NOT NULL, "sourceId" text, "amount" numeric(10,2) NOT NULL, "payerName" text, "items" jsonb, "status" "public"."receipts_status_enum" NOT NULL DEFAULT 'ISSUED', "issuedByUserId" character varying NOT NULL, "voidedByUserId" uuid, "voidedReason" text, "voidedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_8951bd38bd9cd8929d6473ae443" UNIQUE ("receiptNo"), CONSTRAINT "PK_5e8182d7c29e023da6e1ff33bfe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "receipt_audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "receiptId" character varying NOT NULL, "action" character varying NOT NULL, "performedByUserId" character varying NOT NULL, "reason" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dbac7012540ccec66cde2235834" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."ledger_entries_type_enum" AS ENUM('INCOME', 'EXPENSE')`);
        await queryRunner.query(`CREATE TYPE "public"."ledger_entries_category_enum" AS ENUM('PAPER_MONEY_SALES', 'EXTERNAL_DONATION', 'OTHER_INCOME', 'UTILITIES', 'RITUAL_MASTER_FEE', 'REPAIR', 'OFFERING_SUPPLIES', 'OTHER_EXPENSE')`);
        await queryRunner.query(`CREATE TYPE "public"."ledger_entries_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED')`);
        await queryRunner.query(`CREATE TABLE "ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "templeId" uuid NOT NULL, "type" "public"."ledger_entries_type_enum" NOT NULL, "category" "public"."ledger_entries_category_enum" NOT NULL, "amount" numeric(10,2) NOT NULL, "description" text, "occurredAt" date NOT NULL, "status" "public"."ledger_entries_status_enum" NOT NULL DEFAULT 'PENDING', "createdByUserId" character varying NOT NULL, "reviewedByUserId" uuid, "reviewedReason" text, "reviewedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6efcb84411d3f08b08450ae75d5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."ceremonies_feemode_enum" AS ENUM('FREE_WILL', 'FIXED_AMOUNT')`);
        await queryRunner.query(`CREATE TABLE "ceremonies" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "templeId" uuid NOT NULL, "name" character varying NOT NULL, "date" date NOT NULL, "feeMode" "public"."ceremonies_feemode_enum" NOT NULL, "fixedAmount" numeric(10,2), "description" text, "tableCount" integer, "seatsPerTable" integer, "nextSeatIndex" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6135eee2a988c516feec10c188e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "ceremony_registrations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ceremonyId" uuid NOT NULL, "memberId" uuid, "walkInName" character varying, "walkInAddress" character varying, "amount" numeric(10,2) NOT NULL, "wishText" text, "seatIndex" integer, "seatNumber" character varying, "createdByUserId" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_44d53e3515c13d1c4d55af9e10f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "inventory_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "unit" character varying NOT NULL, "currentStock" integer NOT NULL DEFAULT '0', "lowStockThreshold" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_85aeabfff4e52ffadb8bbe76f75" UNIQUE ("name"), CONSTRAINT "PK_cf2f451407242e132547ac19169" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."inventory_transactions_type_enum" AS ENUM('IN', 'OUT')`);
        await queryRunner.query(`CREATE TABLE "inventory_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "itemId" uuid NOT NULL, "type" "public"."inventory_transactions_type_enum" NOT NULL, "quantity" integer NOT NULL, "note" text, "createdByUserId" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9b7144851f08f9eededde7edd42" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "temples" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "templeName" character varying NOT NULL DEFAULT '宮廟名稱', "address" character varying, "phone" character varying, "registrationNo" character varying, "taxId" character varying, "committeeName" character varying, "chairmanTitle" character varying NOT NULL DEFAULT '主任委員', "chairmanName" character varying, "templeSealImagePath" character varying, "chairmanSealImagePath" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_def28f4f57a7b6aecc64f7ff494" UNIQUE ("name"), CONSTRAINT "PK_afcd9274b5ee523a6475599e46c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "members" ADD CONSTRAINT "FK_ddf8dc4797c76f4398121ecdd67" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lantern_slots" ADD CONSTRAINT "FK_149a0d45bff02c223653480b5ba" FOREIGN KEY ("wallId") REFERENCES "lantern_walls"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lantern_claims" ADD CONSTRAINT "FK_f87a0c5746f14d8392cb7dc075c" FOREIGN KEY ("slotId") REFERENCES "lantern_slots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" ADD CONSTRAINT "FK_f67a138046187d7af472cfc855f" FOREIGN KEY ("ceremonyId") REFERENCES "ceremonies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory_transactions" ADD CONSTRAINT "FK_d027ed40e39e81b95d21a3e8c98" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "inventory_transactions" DROP CONSTRAINT "FK_d027ed40e39e81b95d21a3e8c98"`);
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" DROP CONSTRAINT "FK_f67a138046187d7af472cfc855f"`);
        await queryRunner.query(`ALTER TABLE "lantern_claims" DROP CONSTRAINT "FK_f87a0c5746f14d8392cb7dc075c"`);
        await queryRunner.query(`ALTER TABLE "lantern_slots" DROP CONSTRAINT "FK_149a0d45bff02c223653480b5ba"`);
        await queryRunner.query(`ALTER TABLE "members" DROP CONSTRAINT "FK_ddf8dc4797c76f4398121ecdd67"`);
        await queryRunner.query(`DROP TABLE "temples"`);
        await queryRunner.query(`DROP TABLE "inventory_transactions"`);
        await queryRunner.query(`DROP TYPE "public"."inventory_transactions_type_enum"`);
        await queryRunner.query(`DROP TABLE "inventory_items"`);
        await queryRunner.query(`DROP TABLE "ceremony_registrations"`);
        await queryRunner.query(`DROP TABLE "ceremonies"`);
        await queryRunner.query(`DROP TYPE "public"."ceremonies_feemode_enum"`);
        await queryRunner.query(`DROP TABLE "ledger_entries"`);
        await queryRunner.query(`DROP TYPE "public"."ledger_entries_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."ledger_entries_category_enum"`);
        await queryRunner.query(`DROP TYPE "public"."ledger_entries_type_enum"`);
        await queryRunner.query(`DROP TABLE "receipt_audit_logs"`);
        await queryRunner.query(`DROP TABLE "receipts"`);
        await queryRunner.query(`DROP TYPE "public"."receipts_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."receipts_sourcetype_enum"`);
        await queryRunner.query(`DROP TABLE "donations"`);
        await queryRunner.query(`DROP TYPE "public"."donations_type_enum"`);
        await queryRunner.query(`DROP TABLE "lantern_claims"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_149a0d45bff02c223653480b5b"`);
        await queryRunner.query(`DROP TABLE "lantern_slots"`);
        await queryRunner.query(`DROP TABLE "lantern_walls"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2e9903f9aa7c7e15e7d268634a"`);
        await queryRunner.query(`DROP TABLE "members"`);
        await queryRunner.query(`DROP TYPE "public"."members_gender_enum"`);
        await queryRunner.query(`DROP TABLE "households"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
