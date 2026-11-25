import { createHash, randomBytes } from 'node:crypto';
import { loginInputSchema, parseInput, type Role } from '@ofl/domain';
import type { AppConfig } from '../../config';
import { queryOne } from '../../db/db';
import type { Services } from '../../services';
import { verifyAgainstDummy, verifyPassword } from './passwords';

export const SESSION_COOKIE_NAME = 'ofl_session';

export type SessionUser = { id: string; email: string; displayName: string; role: Role };
export type RequestMeta = { correlationId: string; ip?: string };

export type LoginResult = { kind: 'ok'; token: string; user: SessionUser; expiresAt: Date } | { kind: 'invalid' };

export function sessionCookieOptions(config: AppConfig): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAgeSeconds: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAgeSeconds: config.sessionTtlSeconds,
  };
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

// Cookie values are base64url tokens of 32 random bytes (43 characters).
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

type UserRow = { id: string; email: string; display_name: string; role: Role; password_hash: string };

/** Validates input with the domain schema (throws BAD_USER_INPUT) and creates a session on success. */
export async function login(services: Services, input: unknown, meta: RequestMeta): Promise<LoginResult> {
  const credentials = parseInput(loginInputSchema, input);
  const user = await queryOne<UserRow>(
    services.db,
    'SELECT id, email, display_name, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [credentials.email],
  );
  if (!user) {
    await verifyAgainstDummy(credentials.password);
    services.logger.info({ correlationId: meta.correlationId, ip: meta.ip }, 'login rejected');
    return { kind: 'invalid' };
  }
  if (!(await verifyPassword(user.password_hash, credentials.password))) {
    services.logger.info({ correlationId: meta.correlationId, userId: user.id, ip: meta.ip }, 'login rejected');
    return { kind: 'invalid' };
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(services.clock.now().getTime() + services.config.sessionTtlSeconds * 1000);
  await services.db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    user.id,
    expiresAt,
  ]);
  services.logger.info({ correlationId: meta.correlationId, userId: user.id }, 'login succeeded');
  return {
    kind: 'ok',
    token,
    expiresAt,
    user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
  };
}

/** Revokes the session server-side. Unknown or malformed tokens are ignored. */
export async function logout(services: Services, token: string | undefined): Promise<void> {
  if (!token || !TOKEN_FORMAT.test(token)) return;
  await services.db.query('UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL', [
    hashToken(token),
    services.clock.now(),
  ]);
}

export async function resolveSession(services: Services, token: string | undefined): Promise<SessionUser | null> {
  if (!token || !TOKEN_FORMAT.test(token)) return null;
  const row = await queryOne<Omit<UserRow, 'password_hash'>>(
    services.db,
    `SELECT u.id, u.email, u.display_name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
    [hashToken(token), services.clock.now()],
  );
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}
