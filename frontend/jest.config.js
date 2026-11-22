/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['babel-jest', { configFile: './babel.config.jest.js' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
  },
  // #489 — tests live only under `__tests__/`. A test beside its source is not
  // collected (and fails lint, see .eslintrc.json), so a module can never again
  // have two drifting copies of its suite.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  // Playwright e2e suites live in ./e2e and must never run inside Jest.
  // Generated bindings contain speculative WASM specs from dependencies and are
  // type-checked via `tsc` (with `// @ts-nocheck`), not Jest.
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/src/lib/bindings/'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // #536 — frontend coverage is enforced. Thresholds sit just below the
  // measured all-files numbers so small fluctuations don't flake the build,
  // but any meaningful coverage regression fails CI.
  collectCoverage: true,
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 72,
      functions: 77,
      lines: 76,
    },
  },
};

module.exports = config;
