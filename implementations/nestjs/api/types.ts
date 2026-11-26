import type { SessionUser } from '@ofl/server-core';

// Per-request values set by our middleware, typed through Express's Locals
// (NestJS on the Express platform hands us the Express request and response).
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
