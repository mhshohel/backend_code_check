const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  // NestJS uses legacy (experimental) decorators.
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true, decorators: true },
          transform: { react: { runtime: 'automatic' }, legacyDecorator: true },
          target: 'es2023',
        },
        module: { type: 'es6' },
      },
    ],
  },
  roots: ['<rootDir>/tests'],
  // The acceptance suite runs real concurrency scenarios against PostgreSQL.
  testTimeout: 60000,
};
