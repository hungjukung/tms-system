import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 信徒標籤精簡為「一般信徒」「合法信徒」兩種：原本的「榮譽委員」「常務委員」「爐主」「頭家」
 * 一律視為「合法信徒」。tags 欄位是 text[]（非 Postgres enum），直接改資料即可，不需 ALTER TYPE。
 */
export class RemapLegacyMemberTags1785610000000 implements MigrationInterface {
    name = 'RemapLegacyMemberTags1785610000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "members"
            SET "tags" = ARRAY(
                SELECT DISTINCT x FROM unnest(
                    array_replace(
                        array_replace(
                            array_replace(
                                array_replace("tags", 'HONORARY_COMMITTEE', 'LEGAL_MEMBER'),
                                'STANDING_COMMITTEE', 'LEGAL_MEMBER'
                            ),
                            'FURNACE_MASTER', 'LEGAL_MEMBER'
                        ),
                        'PATRON', 'LEGAL_MEMBER'
                    )
                ) AS x
            )
            WHERE "tags" && ARRAY['HONORARY_COMMITTEE','STANDING_COMMITTEE','FURNACE_MASTER','PATRON']
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // 舊標籤已合併為單一「合法信徒」，無法反推回原本四種分類，不提供自動回退
    }

}
