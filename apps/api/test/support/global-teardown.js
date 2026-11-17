module.exports = async () => {
  await globalThis.__TMS_TEST_DB__?.stop();
};
