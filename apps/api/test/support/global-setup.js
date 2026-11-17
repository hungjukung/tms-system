const { startTestDb } = require("./test-db");

module.exports = async () => {
  globalThis.__TMS_TEST_DB__ = await startTestDb();
};
