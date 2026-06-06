module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  collectCoverageFrom: [
    'src/utils/**/*.js',
    'src/services/**/*.js',
    'src/middleware/**/*.js',
    'src/database/models/**/*.js',
    'src/cache/**/*.js',
    'src/webhook/**/*.js',
    'src/handlers/**/*.js',
    '!src/**/index.js',
  ],
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 40,
      functions: 60,
      lines: 60,
    },
  },
  verbose: true,
  testTimeout: 30000,
  setupFilesAfterSetup: [],
};
