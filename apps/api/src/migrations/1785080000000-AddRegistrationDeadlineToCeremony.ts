import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRegistrationDeadlineToCeremony1785080000000 implements MigrationInterface {
    name = 'AddRegistrationDeadlineToCeremony1785080000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremonies" ADD "registrationDeadline" date`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ceremonies" DROP COLUMN "registrationDeadline"`);
    }

}
