/** Default hold time for unpaid reservations. */
export const DEFAULT_RESERVATION_TTL_SECONDS = 15 * 60;

export function reservationExpiry(now: Date, ttlSeconds: number = DEFAULT_RESERVATION_TTL_SECONDS): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

/** A hold is expired when the clock reaches expires_at (inclusive). */
export function isReservationExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}
