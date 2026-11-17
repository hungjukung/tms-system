// 每個整合測試檔案載入前執行：把資料庫連線指到測試專用的臨時 PostgreSQL
const { testDbConfig, applyTestDbEnv } = require("./test-db");

applyTestDbEnv(testDbConfig());
