module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  clearMocks: true,
  restoreMocks: true,
  // Suppress console output during tests (set VERBOSE=1 to see it)
  silent: !process.env.VERBOSE,
};
