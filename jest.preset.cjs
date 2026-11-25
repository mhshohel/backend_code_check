// Shared Jest settings. Every package runs Jest in native ESM mode
// (NODE_OPTIONS=--experimental-vm-modules) because several dependencies
// (graphql-yoga, graphql-ws, zod, react-router) ship as ESM only.
const swcTransform = [
  '@swc/jest',
  {
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      transform: { react: { runtime: 'automatic' } },
      target: 'es2023',
    },
    module: { type: 'es6' },
  },
];

module.exports = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: { '^.+\\.(t|j)sx?$': swcTransform },
  transformIgnorePatterns: ['/node_modules/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json'],
  testTimeout: 30000,
};
