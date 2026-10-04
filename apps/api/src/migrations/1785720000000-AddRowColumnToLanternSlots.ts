import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 新增燈位的排號/格號欄位，讓「燈位表」可以照建立時在畫布上點選的實際形狀排列顯示（之前只存 code 字串，
 * 顯示時只能扁平排列、跑掉原本的排列形狀）。
 * 既有燈位的 code 一律是 `${前綴}${排號}-${兩位數格號}`（多排）或 `${前綴}-${兩位數格號}`（單排，排號省略、視為第 1 排），
 * 前綴為中文字不含數字，故可用 regexp 安全回填既有資料。
 */
export class AddRowColumnToLanternSlots1785720000000 implements MigrationInterface {
    name = 'AddRowColumnToLanternSlots1785720000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_slots" ADD "row" integer`);
        await queryRunner.query(`ALTER TABLE "lantern_slots" ADD "column" integer`);

        await queryRunner.query(`
            UPDATE "lantern_slots" SET
              "row" = COALESCE((regexp_match(code, '^\\D+(\\d+)-(\\d+)$'))[1]::int, 1),
              "column" = COALESCE(
                (regexp_match(code, '^\\D+(\\d+)-(\\d+)$'))[2]::int,
                (regexp_match(code, '^\\D+-(\\d+)$'))[1]::int
              )
        `);

        await queryRunner.query(`ALTER TABLE "lantern_slots" ALTER COLUMN "row" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "lantern_slots" ALTER COLUMN "column" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_slots" DROP COLUMN "column"`);
        await queryRunner.query(`ALTER TABLE "lantern_slots" DROP COLUMN "row"`);
    }

}
