// The fixture tests reset ofl_core_test, so they run serially.
module.exports = { ...require('../../jest.preset.cjs'), roots: ['<rootDir>/tests'], testTimeout: 120000, maxWorkers: 1 };
