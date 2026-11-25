/**
 * Reads extensions-style codes from errors thrown by @ofl/server-core
 * (AppError). Checked structurally so it also works across module copies.
 */
export function appErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
