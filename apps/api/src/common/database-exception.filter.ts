import { ArgumentsHost, BadRequestException, Catch } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { QueryFailedError } from "typeorm";

/**
 * 使用者送來的值格式不對（例如網址上的 id 不是 UUID、列舉值不存在、日期或數字無法解析）時，
 * PostgreSQL 會回這幾種錯誤碼。這是「輸入錯誤」而不是伺服器壞掉，統一轉成 400，
 * 避免前端看到 500 誤以為系統當機。其他資料庫錯誤照舊回 500。
 */
const INVALID_INPUT_CODES = new Set([
  "22P02", // invalid_text_representation（UUID、enum、數字格式錯誤）
  "22007", // invalid_datetime_format
  "22008", // datetime_field_overflow
  "22003", // numeric_value_out_of_range
  "2201W", // invalid_row_count_in_limit_clause
  "2201X", // invalid_row_count_in_result_offset_clause
]);

@Catch(QueryFailedError)
export class DatabaseExceptionFilter extends BaseExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const code = (exception as unknown as { code?: string }).code;
    if (code && INVALID_INPUT_CODES.has(code)) {
      return super.catch(new BadRequestException("輸入的資料格式不正確"), host);
    }
    return super.catch(exception, host);
  }
}
