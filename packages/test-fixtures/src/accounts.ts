import { fixtureId, NS } from './ids';

export type FixtureRole = 'CUSTOMER' | 'OPERATOR' | 'ADMIN';
export type FixtureAccount = { id: string; email: string; password: string; displayName: string; role: FixtureRole };

/** Demo accounts (requirements §12). They exist only in local seed data. */
export const DEMO_ACCOUNTS = {
  customer: { id: fixtureId(NS.user, 1), email: 'customer@example.com', password: 'customer-pass-1', displayName: 'Casey Customer', role: 'CUSTOMER' },
  customer2: { id: fixtureId(NS.user, 2), email: 'customer2@example.com', password: 'customer-pass-2', displayName: 'Robin Second', role: 'CUSTOMER' },
  operator: { id: fixtureId(NS.user, 3), email: 'operator@example.com', password: 'operator-pass-1', displayName: 'Olivia Operator', role: 'OPERATOR' },
  admin: { id: fixtureId(NS.user, 4), email: 'admin@example.com', password: 'admin-pass-1', displayName: 'Adam Admin', role: 'ADMIN' },
} as const satisfies Record<string, FixtureAccount>;

export const WAREHOUSES = {
  east: { id: fixtureId(NS.warehouse, 1), code: 'WH-EAST', name: 'East Fulfillment Center', priority: 1 },
  west: { id: fixtureId(NS.warehouse, 2), code: 'WH-WEST', name: 'West Fulfillment Center', priority: 2 },
} as const;
