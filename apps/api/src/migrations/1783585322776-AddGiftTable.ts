import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGiftTable1783585322776 implements MigrationInterface {
    name = 'AddGiftTable1783585322776'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."gifts_gifttype_enum" AS ENUM('FLOWERS', 'LONGEVITY', 'WATER', 'BEER', 'DRINKS', 'OTHER')`);
        await queryRunner.query(`CREATE TABLE "gifts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "templeId" uuid NOT NULL, "memberId" uuid, "walkInName" character varying, "giftType" "public"."gifts_gifttype_enum" NOT NULL, "createdByUserId" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_54242922934e1f322861d116af7" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "gifts"`);
        await queryRunner.query(`DROP TYPE "public"."gifts_gifttype_enum"`);
    }

}
