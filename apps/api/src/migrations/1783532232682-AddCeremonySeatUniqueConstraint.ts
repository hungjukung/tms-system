import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCeremonySeatUniqueConstraint1783532232682 implements MigrationInterface {
    name = 'AddCeremonySeatUniqueConstraint1783532232682'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" ADD CONSTRAINT "uq_ceremony_seat" UNIQUE ("ceremonyId", "seatIndex")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremony_registrations" DROP CONSTRAINT "uq_ceremony_seat"`);
    }

}
