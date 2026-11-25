module.exports = {
  ...require('../../jest.preset.cjs'),
  roots: ['<rootDir>/tests'],
  // The acceptance suite runs real concurrency scenarios against PostgreSQL.
  testTimeout: 60000,
};
