import { hashPassword } from '@ofl/server-core';
import { DEMO_ACCOUNTS, WAREHOUSES } from '../accounts';
import type { Dataset } from '../dataset';

export async function addDemoAccounts(dataset: Dataset): Promise<void> {
  for (const account of Object.values(DEMO_ACCOUNTS)) {
    dataset.users.push({
      id: account.id,
      email: account.email,
      display_name: account.displayName,
      password_hash: await hashPassword(account.password),
      role: account.role,
    });
  }
}

export function addWarehouses(dataset: Dataset): void {
  for (const warehouse of Object.values(WAREHOUSES)) dataset.warehouses.push({ ...warehouse });
}

export function daysAgo(now: Date, days: number, minutes = 0): Date {
  return new Date(now.getTime() - days * 86_400_000 - minutes * 60_000);
}
