const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  // jsdom plus Node's Fetch API classes (see tests/jsdom-environment.mjs).
  testEnvironment: '<rootDir>/tests/jsdom-environment.mjs',
  roots: ['<rootDir>/tests'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: { '\\.css$': '<rootDir>/tests/style-stub.cjs' },
};
