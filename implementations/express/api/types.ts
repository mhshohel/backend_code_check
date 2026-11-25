import type { SessionUser } from '@ofl/server-core';

// Per-request values set by our middleware, typed through Express's Locals.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      correlationId: string;
      viewer: SessionUser | null;
    }
  }
}

export {};
