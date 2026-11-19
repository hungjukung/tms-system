import { MigrationInterface, QueryRunner } from "typeorm";

/** 點燈改依燈種計價：廟宇設定新增燈種與價格，既有廟宇先帶入預設的 6 種燈種 */
export class AddLanternTypePrices1785830000000 implements MigrationInterface {
    name = 'AddLanternTypePrices1785830000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "temples" ADD "lanternTypes" jsonb`);
        await queryRunner.query(`UPDATE "temples" SET "lanternTypes" = '[{"name":"平安燈(大)","price":5000},{"name":"平安燈(中)","price":3000},{"name":"平安燈","price":1000},{"name":"發財燈","price":600},{"name":"光明燈","price":600},{"name":"太歲燈","price":500}]'::jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "temples" DROP COLUMN "lanternTypes"`);
    }

}
