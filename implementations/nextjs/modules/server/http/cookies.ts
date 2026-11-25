export type CookieOptions = {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  path: string;
  maxAgeSeconds: number;
};

const SAME_SITE: Record<CookieOptions['sameSite'], string> = { lax: 'Lax', strict: 'Strict', none: 'None' };

/**
 * Builds a Set-Cookie header value. Route handlers write the header directly
 * (instead of next/headers cookies()) so they also run outside a Next request
 * scope, for example when tests call the exported handlers.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, `Max-Age=${options.maxAgeSeconds}`];
  if (options.maxAgeSeconds > 0) parts.push(`Expires=${new Date(Date.now() + options.maxAgeSeconds * 1000).toUTCString()}`);
  else parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${SAME_SITE[options.sameSite]}`);
  return parts.join('; ');
}

export function expiredCookie(name: string, options: CookieOptions): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}
