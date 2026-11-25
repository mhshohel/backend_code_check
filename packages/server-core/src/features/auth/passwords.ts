import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 defaults to Argon2id (m=19 MiB, t=2, p=1), the OWASP
// baseline. The parameters are stored in the hash, so they can change later.
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Verifies against a fixed hash when the account does not exist, so a login
 * for an unknown email takes as long as one for a known email.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hash('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
}
