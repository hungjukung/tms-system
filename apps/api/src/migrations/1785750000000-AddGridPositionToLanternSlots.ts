import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 燈位新增「畫布上的實際位置」欄位，與編號用的 row/column 分開，才能支援由左至右／由下至上等不同編號方向。
 * 既有燈位一律以「由右至左、由上至下」顯示（燈位圖原本就是 column 大的排左邊），
 * 回填為 gridRow = row、gridColumn = 該燈牆最大 column + 1 - column，既有燈牆的燈位圖排列維持不變。
 */
export class AddGridPositionToLanternSlots1785750000000 implements MigrationInterface {
    name = 'AddGridPositionToLanternSlots1785750000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_slots" ADD "gridRow" integer`);
        await queryRunner.query(`ALTER TABLE "lantern_slots" ADD "gridColumn" integer`);

        await queryRunner.query(`
            UPDATE "lantern_slots" s SET
              "gridRow" = s."row",
              "gridColumn" = m.max_column + 1 - s."column"
            FROM (SELECT "wallId", MAX("column") AS max_column FROM "lantern_slots" GROUP BY "wallId") m
            WHERE s."wallId" = m."wallId"
        `);

        await queryRunner.query(`ALTER TABLE "lantern_slots" ALTER COLUMN "gridRow" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "lantern_slots" ALTER COLUMN "gridColumn" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_slots" DROP COLUMN "gridColumn"`);
        await queryRunner.query(`ALTER TABLE "lantern_slots" DROP COLUMN "gridRow"`);
    }

}
