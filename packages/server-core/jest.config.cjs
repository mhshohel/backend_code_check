// Integration tests share one database (ofl_core_test), so they run serially.
module.exports = {
  ...require('../../jest.preset.cjs'),
  roots: ['<rootDir>/tests'],
  testTimeout: 60000,
  maxWorkers: 1,
};
