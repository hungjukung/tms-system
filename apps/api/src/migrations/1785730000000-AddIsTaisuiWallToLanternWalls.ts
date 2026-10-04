import { MigrationInterface, QueryRunner } from "typeorm";

/** 新增燈牆的「太歲燈牆」標記，供前端限制點燈內容只能選「太歲燈」使用 */
export class AddIsTaisuiWallToLanternWalls1785730000000 implements MigrationInterface {
    name = 'AddIsTaisuiWallToLanternWalls1785730000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_walls" ADD "isTaisuiWall" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "lantern_walls" DROP COLUMN "isTaisuiWall"`);
    }

}
