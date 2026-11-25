import '@testing-library/jest-dom/jest-globals';
import { afterEach } from '@jest/globals';
import { cleanup } from '@testing-library/react';
import { resetRouterMock } from './next-navigation';

afterEach(() => {
  cleanup();
  resetRouterMock();
});
