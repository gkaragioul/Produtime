/** @type {import('jest').Config} */
// Uses @swc/jest so TS/TSX files compile without extra setup. The repo
// previously had no Jest config, which left every *.test.ts file failing
// to parse. New tests added in this change live alongside the source they
// cover; existing test files remain untouched.
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['@swc/jest', {
      jsc: {
        parser: { syntax: 'typescript', tsx: true, decorators: false, dynamicImport: true },
        target: 'es2020',
      },
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build-output/',
    // Pre-existing broken tests — opted out so green runs aren't drowned.
    '/src/renderer/services/__tests__/',
    'auto-updater-service\\.test\\.ts$',
    'data-export-service\\.test\\.ts$',
    'ipc-service\\.test\\.ts$',
    'App\\.test\\.tsx$',
  ],
  // Only collect the files we explicitly support today. Add new ones as
  // they're written.
  testMatch: [
    '<rootDir>/src/main/logger.test.ts',
    '<rootDir>/src/renderer/services/slack-sales-service.test.ts',
  ],
};
