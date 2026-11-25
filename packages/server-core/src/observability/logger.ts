import { pino, type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

// Field names that may hold personal data or secrets, at the top level and
// one or two levels deep. pino replaces their values before serialization.
const SENSITIVE_KEYS = ['email', 'password', 'token', 'cookie', 'authorization', 'passwordHash', 'secret'];
export const REDACT_PATHS = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  ...SENSITIVE_KEYS.map((key) => `*.*.${key}`),
  'req.headers.cookie',
  'req.headers.authorization',
  'headers.cookie',
  'headers["x-ofl-signature"]',
];

export function createLogger(options: { level: string; name?: string; destination?: NodeJS.WritableStream }): Logger {
  const settings = {
    level: options.level,
    name: options.name ?? 'ofl',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return options.destination ? pino(settings, options.destination) : pino(settings);
}
