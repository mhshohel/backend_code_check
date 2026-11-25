/**
 * Browsers always send Origin on WebSocket upgrades, so a present Origin must
 * be on the allowlist (blocks cross-site WebSocket hijacking with the user's
 * cookie). Non-browser clients send none and are allowed; they still need a
 * valid session cookie for any subscription (requirements §10).
 */
export function isAllowedOrigin(origin: string | undefined, allowlist: readonly string[]): boolean {
  if (origin === undefined || origin === '') return true;
  return allowlist.includes(origin);
}

export function parseOriginList(value: string | undefined, fallback: readonly string[]): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : [...fallback];
}

/** The app is reachable as localhost and 127.0.0.1 in development; both are first-party. */
export function defaultAppOrigins(appPort: number): string[] {
  return [`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`];
}
