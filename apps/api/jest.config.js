/**
 * 測試分兩個 project：
 *  - unit：白箱單元測試，資料庫全部用 mock，直接針對 service 內部的分支寫，不需要任何外部服務
 *  - integration：黑箱整合測試，啟動整個 Nest 應用程式接上「測試專用的臨時 PostgreSQL」，只透過 HTTP API 驗證行為
 */
const base = {
  rootDir: __dirname,
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "js", "json"],
  // 直接讀 shared 的原始碼，不需要先 build，覆蓋率也能算到 shared
  moduleNameMapper: { "^@tms/shared$": "<rootDir>/../../packages/shared/src/index.ts" },
  transform: { "^.+\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.spec.json", diagnostics: false }] },
};

module.exports = {
  projects: [
    { ...base, displayName: "unit", testMatch: ["<rootDir>/test/unit/**/*.spec.ts"] },
    {
      ...base,
      displayName: "integration",
      testMatch: ["<rootDir>/test/integration/**/*.int-spec.ts"],
      globalSetup: "<rootDir>/test/support/global-setup.js",
      globalTeardown: "<rootDir>/test/support/global-teardown.js",
      setupFiles: ["<rootDir>/test/support/test-env.js"],
    },
  ],
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "<rootDir>/../../packages/shared/src/**/*.ts",
    "!<rootDir>/src/migrations/**",
    "!<rootDir>/src/main.ts",
    "!<rootDir>/src/seed.ts",
    "!<rootDir>/src/config/**",
    "!<rootDir>/src/**/*.module.ts",
    "!<rootDir>/src/**/dto/**",
    "!<rootDir>/src/**/entities/**",
  ],
  coverageDirectory: "<rootDir>/coverage",
  testTimeout: 30000,
};
