import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
const realtimePort = process.env.REALTIME_PORT ?? '9009';
const realtimeSources = process.env.REALTIME_PUBLIC_URL
  ? process.env.REALTIME_PUBLIC_URL
  : `ws://localhost:${realtimePort} ws://127.0.0.1:${realtimePort}`;

// Next injects inline bootstrap scripts. A nonce-based CSP would require
// rendering every page per request through proxy.ts; the user-specific pages
// are dynamic anyway, but the tradeoff is documented in the README. We keep
// 'unsafe-inline' for scripts and lock down everything else.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${realtimeSources}${isDev ? ' ws://localhost:9008' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `next build` type-checks app code only; `pnpm typecheck` also covers the tests.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@ofl/server-core', '@ofl/domain', '@ofl/graphql-types'],
  // Native addons and Node-heavy libraries stay as runtime imports. (graphql
  // is ESM-only and is bundled; each bundle builds its own schema instance.)
  serverExternalPackages: ['pg', '@node-rs/argon2', '@elastic/elasticsearch', 'pino', 'pino-pretty', 'prom-client', 'ws'],
  experimental: {
    // Enables forbidden() + app/forbidden.tsx for role checks in pages.
    authInterrupts: true,
    serverActions: {
      // Same limit as the route handlers (requirements §10).
      bodySizeLimit: '100kb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
