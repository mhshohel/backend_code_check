// Two projects:
// - components: client components in jsdom with React Testing Library. Next's
//   router and Link are replaced by small test doubles (tests/support).
// - server: route handlers, pure server modules, and HTTP integration tests
//   against a running `next start` (see tests/http and README "Testing").
const preset = require('../../jest.preset.cjs');

const sharedMappers = {
  '^@/(.*)$': '<rootDir>/$1',
  '^server-only$': '<rootDir>/tests/support/empty-module.ts',
};

module.exports = {
  projects: [
    {
      ...preset,
      displayName: 'components',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/tests/components'],
      setupFilesAfterEnv: ['<rootDir>/tests/support/setup-dom.ts'],
      moduleNameMapper: {
        ...sharedMappers,
        '^next/navigation$': '<rootDir>/tests/support/next-navigation.ts',
        '^next/link$': '<rootDir>/tests/support/next-link.tsx',
      },
    },
    {
      ...preset,
      displayName: 'server',
      testEnvironment: 'node',
      roots: ['<rootDir>/tests/server', '<rootDir>/tests/http', '<rootDir>/tests/acceptance'],
      moduleNameMapper: sharedMappers,
    },
  ],
};
